/* eslint-disable */

const express = require('express');
const helmet = require('helmet');
const { Database } = require('@libertyio/data-collection-memory-js');
const { WebauthzMemoryDatabase } = require('@webauthz/sdk-app-data-memory-js');
const { Webauthz } = require('@webauthz/sdk-app-core-node-js');
const mustacheExpress = require('mustache-express');
const { randomHex } = require('@cryptium/random-node-js');
const { Log } = require('@libertyio/log-node-js');
const bodyParser = require('body-parser');
const cookie = require('cookie');
const axios = require('axios');

// http configuration
const { LISTEN_PORT = 29002 } = process.env;
const { ENDPOINT_URL = `http://localhost:${LISTEN_PORT}` } = process.env;

// in-memory database
const database = new Database({ log: new Log({ tag: 'Database', enable: { error: true, warn: true, info: true, trace: true } }) });

// webauthz plugin with in-memory database
const webauthzPlugin = new Webauthz({
    log: new Log({ tag: 'Webauthz', enable: { error: true, warn: true, info: true, trace: true } }),
    database: new WebauthzMemoryDatabase({ log: new Log({ tag: 'WebauthzMemoryDatabase', enable: { error: true, warn: true, info: true, trace: true } }), }),
    client_name: 'Test Webauthz Application',
    grant_redirect_uri: `${ENDPOINT_URL}/webauthz/grant`,
});

// express middleware to ask browsers not to cache results
function setNoCache(req, res, next) {
  res.set('Pragma', 'no-cache');
  res.set('Cache-Control', 'no-cache, no-store');
  next();
}

// session management
const COOKIE_NAME = 'test_app';

async function session(req, res, next) {
    let sessionId = null;
    let sessionInfo = {};
    const cookieHeader = req.get('Cookie');
    if (cookieHeader) {
        const cookieMap = cookie.parse(cookieHeader);
        sessionId = cookieMap[COOKIE_NAME];
    }
    if (sessionId) {
        sessionInfo = await database.collection('session').fetchById(sessionId);
    }
    if (!sessionId || !sessionInfo || typeof sessionInfo !== 'object') {
        // create a new session
        sessionId = randomHex(16);
        sessionInfo = { username: null, notAfter: null };
        await database.collection('session').insert(sessionId, sessionInfo);
    }
    // make session content available to routes
    req.session = sessionInfo;
    // set or update the cookie to expire after some time
    const millis = 15 /* minutes */ * 60 /* seconds per minute */ * 1000 /* ms per second */;
    const expiresMillis = Date.now() + millis;
    res.cookie(COOKIE_NAME, sessionId, {
        // ask browser to...
        maxAge: millis, // keep cookie for this length of time (for standards-compliant browsers; the actual header is converted to seconds)
        expires: new Date(expiresMillis), // or keep cookie until this date (for old browsers, should be ignored by browsers that use max-age)
        httpOnly: true, // do not disclose cookie to javascript or extensions unless user grants secure cookie permissions
        secure: process.env.NODE_ENV === 'production', // only send the cookie with https requests
    });
    // listen for end of request processing to store session info
    res.on('finish', async () => {
    // store session data
        await database.collection('session').editById(sessionId, req.session);
    });
    next();
}

function isSessionAuthenticated({ username, notAfter } = {}) {
    return username && typeof notAfter === 'number' && Date.now() <= notAfter;
}

// anyone can login to the demo with a username
// in production a resource server should require authentication (e.g. password), but this is only a demo
async function httpPostLogin(req, res) {
    // login process starts with a non-authenticated session
    req.session.username = null;
    req.session.notAfter = null;
    const { username } = req.body;
    if (typeof username !== 'string' || username.trim().length === 0) {
        console.log('httpPostLogin: non-empty username is required');
        return res.render('main', { error: 'username required to login' });
    }

    const seconds = 900; // 60 seconds in 1 minute * 15 minutes
    const expiresMillis = Date.now() + (seconds * 1000);
    req.session.username = username;
    req.session.notAfter = expiresMillis;
    console.log(`httpPostLogin: ${username}`);

    // redirect to main page
    res.status(303);
    res.set('Location', '/');
    res.end();
}

// logout
async function httpPostLogout(req, res) {
    req.session.username = null;
    req.session.notAfter = null;
    // redirect to main page
    res.status(303);
    res.set('Location', '/');
    res.end();    
}


// only authenticated users may use the application
async function httpGetResource(req, res) {
    const isAuthenticated = isSessionAuthenticated(req.session);
    if (!isAuthenticated) {
        res.status(401);
        return res.render('main', { error: 'login to access resources' });
    }

    const { url: resourceURL } = req.query;

    if (!resourceURL) {
        console.log(`httpGetResource: main page`);
        return res.render('fault', { fault: 'resource url is required' });
    }

    console.log(`httpGetResource: resourceURL ${resourceURL}`);

    const headers = { 'Accept': 'application/json' };

    // check if an access token is already available for this resource and for this user
    const accessToken = await webauthzPlugin.getAccessToken({ resource_uri: resourceURL, user_id: req.session.username });
    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
        // make the http request for the resource
        console.log(`httpGetResource: GET ${resourceURL} ...`);
        const response = await axios.get(resourceURL, { headers });
        if (response.data) {
            // success
            return res.render('main', { content: JSON.stringify(response.data, null, 2), url: resourceURL, username: req.session.username });
        }
    } catch (err) {
        // request failed, check for a Webauthz challenge in the response
        if (err.response) {
            try {
                const webauthzInfo = await webauthzPlugin.checkResponseForWebauthz({ user_id: req.session.username, resource_uri: resourceURL, http_response: err.response });
                if (webauthzInfo) {
                    // found a Webauthz challenge; prepare a Webauthz access request for the resource
                    const { access_request_uri } = await webauthzPlugin.createAccessRequest(webauthzInfo, { method: 'GET' });
                    // show the error we got from the resource, and also the fact that it supports Webauthz
                    return res.render('main', {
                        error: `${err.response.status} ${err.response.statusText}`,
                        url: resourceURL,
                        webauthz: access_request_uri,
                        username: req.session.username
                    });
                }
            } catch (err2) {
                console.error(`httpGetResource: webauthz check failed`, err2);
            }
            // did not find a Webauthz challenge; show the status from the http response
            return res.render('main', { error: `${err.response.status} ${err.response.statusText}`, url: resourceURL, username: req.session.username });
        } else {
            console.error('unexpected error while accessing resource', err);
        }
    }

    return res.render('main', { error: 'request failed', url: resourceURL, username: req.session.username });
}

async function httpGetWebauthzGrant(req, res) {

    // only authenticated users allowed because we need to check that it's the same user associated to the request
    const isAuthenticated = isSessionAuthenticated(req.session);
    if (!isAuthenticated) {
        res.status(401);
        return res.render('main', { error: 'login to manage webauthz requests' });
    }

    const { client_id, client_state, grant_token, status } = req.query;

    if (typeof client_id !== 'string' || !client_id) {
        res.status(400);
        return res.render('fault', { fault: 'client_id required' });
    }
    if (typeof client_state !== 'string' || !client_state) {
        res.status(400);
        return res.render('fault', { fault: 'client_state required' });
    }

    try {
        // load the access request identified by client_state, scoped to the current user
        const { resource_uri } = await webauthzPlugin.getAccessRequest(client_state, req.session.username);

        if (status === 'denied') {
            res.status(403);
            return res.render('main', { error: 'access denied', url: resource_uri, username: req.session.username });
        }
    
        try {
            // exchange the grant token for an access token
            const { status: exchange_status } = await webauthzPlugin.exchange({ client_id, client_state, grant_token, user_id: req.session.username });
            if (exchange_status === 'granted') {
                // redirect the user to the user interface where we access the resource
                res.status(303);
                res.set('Location', `/resource?url=${encodeURIComponent(resource_uri)}`);
                res.end();
                return;
            }
        } catch (err) {
            console.error('httpGetWebauthzGrant: error', err);
            res.status(403);
            return res.render('main', { error: 'access denied', url: resource_uri, username: req.session.username });
        }
    
    } catch (err) {
        console.error('httpGetWebauthzGrant: failed to retrieve access request', err);
        res.status(400);
        return res.render('fault', { fault: 'invalid request' });
    }
}

async function httpGetMainPage(req, res) {
  const { url } = req.query;
  return res.render('main', { url, username: req.session.username });
}

// configure express framework
const expressApp = express();
expressApp.engine('html', mustacheExpress());
expressApp.set('view engine', 'html');
expressApp.set('views', __dirname + '/views');
expressApp.set('query parser', 'simple');
expressApp.set('x-powered-by', false);
expressApp.use(helmet());
expressApp.use(setNoCache);

// configure main user interface routes
expressApp.get('/resource', session, httpGetResource);
expressApp.post('/login', session, bodyParser.urlencoded({ extended: false }), httpPostLogin);
expressApp.post('/logout', session, bodyParser.urlencoded({ extended: false }), httpPostLogout);
expressApp.get('/', session, httpGetMainPage);

// configure webauthz user interface routes
expressApp.get('/webauthz/grant', session, httpGetWebauthzGrant);

// configure error handling
expressApp.use((err, req, res, next) => {
  if (err) {
      res.status(500);
      if (req.get('Accept') === 'application/json') {
        return res.json({ error: 'server-error' });
      }
      return res.render('error', { error: err.message, stack: err.stack });
  }
  return next(err);
});

// start http server
const server = expressApp.listen(LISTEN_PORT);
console.log('http service started');
console.info(ENDPOINT_URL);

['SIGINT', 'SIGTERM', 'SIGQUIT']
  .forEach(signal => process.on(signal, async () => {
      // shutdown express server
      server.close(() => {
        console.log('Http server closed.');
        process.exit();
      });
  }));

