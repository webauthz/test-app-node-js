Webauthz Test Application
=========================

This is a self-contained web application used to test the Webauthz
protocol and the [SDK](https://github.com/webauthz/sdk-app-core-node-js).

This service stores all its data in memory, so every time you start
or restart the service, you have to start over with creating a new
account.

# Quick start

Install dependencies:

```
npm install
```

Start the server:

```
npm start
```

Open your browser:

```
http://localhost:29002
```

# Customize

You can change the port number by setting the `LISTEN_PORT` environment
variable before you run `npm start`.

In Linux:

```
export LISTEN_PORT=29002
```

In PowerShell:

```
$env:LISTEN_PORT="29002"
```

# Developer Guide

This is a practical guide for developers who are integrating Webauthz into
an application to request access to a remote resource. It is based on the
[Webauthz specification](https://github.com/webauthz/handbook).

## Assumptions

There is a web application at `https://application.test`, or possibly a mobile or
desktop application with an associated website `https://application.test`.

The application name is `Example App`.

The application can use a remote resource, such as a user's contacts,
calendar, documents, photos, audio, or videos.

The remote resource is hosted by a service (separate from the application)
that supports Webauthz.

The resource is available for authorized clients via an API at
`https://api.resource.test/content/xyzzy`.

A user of the application wants to use a feature which requires access to the
remote resource.

## Getting started

The application determines that access is required to a remote resource
located at `https://api.resource.test/content/xyzzy`.

The application attempts to access the resource:

```
curl 'https://api.resource.test/content/xyzzy'
```

The resource requires authorization, and the application didn't provide any,
so the resource responds with:

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm=Webauthz, scope=resource, webauthz_discovery_uri=https%3A%2F%2Fapi.resource.test%3A29001%2Fwebauthz.json, path=%2Fcontent
```

The `401 Unauthorized` status and the `WWW-Authenticate` header with the `Bearer` type
and the `webauthz_discovery_uri` auth-param are indications that the server supports
Webauthz.

Parsing hints for the `WWW-Authenticate` header:

1. Check if it starts with `Bearer `, if so then continue
2. Trim `Bearer ` from the beginning of the value
3. Split the remaining comma-separated auth-params
4. Trim surrounding whitespace from each auth-param
5. Split each auth-param on the equal sign to obtain key-value pairs
6. URI-decode each value

## Discovery

The application fetches the document referenced by the `webauthz_discovery_uri` auth-param:

```
curl -H 'Accept: application/json' 'https://api.resource.test/webauthz.json'
```

The authorization server responds with:

```
HTTP/1.1 200 OK
Content-Type: application/json

{"webauthz_register_uri":"https://api.resource.test/webauthz/register","webauthz_request_uri":"https://api.resource.test/webauthz/request","webauthz_exchange_uri":"https://api.resource.test/webauthz/exchange"}
```

The application stores this information.

In the future, when fetching the same document, the application may use HTTP
caching mechanisms such as entity tags, conditional requests, etc. to only
fetch the same document again if its content has changed.

## Registration

The application registers with the authorization server to obtain a credential for using
Webauthz APIs, using a `POST` to the `webauchz_register_uri`:

```
curl \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -X POST \
  --data '{"client_name": "Example App", "grant_redirect_uri": "https://application.test/webauthz/grant"}' \
  'https://api.resource.test/webauthz/register'
```

The authorization server responds with:

```
HTTP/1.1 200 OK
Content-Type: application/json

{"client_id":"373507121abbb6f2","client_token":"8ae505ee5afb9330396b11cb4290f00a48ac8b692863e6ba531b3f114707c9e8"}
```

The application stores the `client_id` and `client_token` values, associated to the
origin URI of the authorization server, `https://api.resource.test`.

## Access request

The application generates a `client_state` value. This is a unique identifier for
the current access request. For example: `13636d5bcd89a2e8`.

The `realm` and `scope` values in the following request come from the `WWW-Authenticate`
header in the first request step. The bearer token in the `Authorization` header is the
`client_token` value obtained from the registration step.

The application starts the access request with a `POST` to the `webauthz_request_uri`:

```
curl \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer 8ae505ee5afb9330396b11cb4290f00a48ac8b692863e6ba531b3f114707c9e8' \
  -X POST \
  --data '{"client_state": "13636d5bcd89a2e8", "realm": "Webauthz", "scope": "resource"}' \
  'https://api.resource.test/webauthz/request'
```

The authorization server responds with:

```
HTTP/1.1 200 OK
Content-Type: application/json

{"redirect":"https://resource.test/webauthz/prompt?id=7fcc8de4611f5dbbfba124190222e4f5","redirect_max_seconds":900}
```

This indicates that to request access to the resource, the application must redirect the
user to the URL `https://resource.test/webauthz/prompt?id=7fcc8de4611f5dbbfba124190222e4f5`.
That link is valid for 900 seconds (15 minutes). After that time, the application must repeat
this step to obtain a new redirect URL.

## Redirect

The application redirects the user to the redirect URL obtained in the access request
step.

Link example:

```
<a href="https://resource.test/webauthz/prompt?id=7fcc8de4611f5dbbfba124190222e4f5">Continue</a>
```

Redirect example:

```
HTTP/1.1 303 See Other
Location: https://resource.test/webauthz/prompt?id=7fcc8de4611f5dbbfba124190222e4f5
```

## Grant token

The authorization server will prompt the user to approve or deny the
application's access to the user's resource.

If the user denies the access, the authorization server redirects the user to
the application's `grant_redirect_uri` with the query parameters `client_id`,
`client_state`, and `status=denied`:

```
https://application.test/webauthz/grant?client_id=373507121abbb6f2&client_state=13636d5bcd89a2e8&status=denied
```

When this happens, the application informs the user that the access was denied,
and provides another opportunity to request access.

If the user approves the access, the authorization server redirects the user to
the application's `grant_redirect_uri` with the query parameters `client_id`,
`client_state`, and `grant_token`:

```
https://application.test/webauthz/grant?client_id=373507121abbb6f2&client_state=13636d5bcd89a2e8&grant_token=020ebf8cb6592689
```

When this happens, the application informs the user that access is being obtained.

## Exchange with grant token

The application sends a `POST` to the `webauthz_exchange_uri`
to exchange the grant token for an access token and refresh token:

```
curl \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer 8ae505ee5afb9330396b11cb4290f00a48ac8b692863e6ba531b3f114707c9e8' \
  -X POST \
  --data '{"grant_token": "020ebf8cb6592689"}' \
  'https://api.resource.test/webauthz/exchange'
```

The authorization server responds with:

```
HTTP/1.1 200 OK
Content-Type: application/json

{"access_token":"3d21c726822ef4b509322bef048595cdaf5ca2c0c7e6ff44","access_token_max_seconds":3600,"refresh_token":"f091c28660ac09b932aeeec047febc7f8060696bc33fb264","refresh_token_max_seconds":86400}
```

This indicates the application can use the access token for 3,600 seconds
(1 hour). At that time it will expire and the application will need to use
the refresh token with the exchange API to obtain a new access token.

The refresh token itself will expire in 86,400 seconds (24 hours). The
application will obtain a new refresh token with a subsequent exchange request.
The application is responsible for obtaining a new refresh token before the
current one expires, so if it isn't making any routine exchange requests for
new access tokens during that time, it should schedule an exchange request
specifically for obtaining a new refresh token to maintain its access without
having to involve the user again.

The authorization server will continue issuing new access tokens and refresh
tokens until the underlying permission expires. This is completely up to the
authorization server and is not visible to the application until it happens,
when the authorization server will respond to an exchange request with an
error, like this:

```
HTTP/1.1 403 Forbidden
```

## Resource request with authorization

The application attempts to access the resource again, this time with the
`access_token` in the `Authorization` header:

```
curl -H 'Authorization: Bearer 3d21c726822ef4b509322bef048595cdaf5ca2c0c7e6ff44' 'https://api.resource.test/content/xyzzy'
```

The resource server responds with the content.

## Managing access tokens

When the resource server denies access to a resource and includes the
`WWW-Authenticate` header in the response, one of the auth-param keys in
that header is `path`. In the following example, the value of `path` is
`/content` (URI-encoded to `%2Fcontent`):

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm=Webauthz, scope=resource, webauthz_discovery_uri=https%3A%2F%2Fapi.resource.test%3A29001%2Fwebauthz.json, path=%2Fcontent
```

This means that, even though the request was for `/content/xyzzy`,
when the application follows the Webauthz authorization sequence and
obtains an access token, that access token is valid for all URLs
under `/content`, such as `/content/file2` and `/content/dir3/file4`.

When the application needs to request a resource under the `/content`
path, it can pre-emptively include the `Authorization` header with the
corresponding access token.

To do this, an application needs to index access tokens according to the
resource server origin (`https://api.resource.test`) and the path
(`/content`).

Each time the application makes a resource request, it checks the index
for an available access token:

1. Extract the origin from the resource request (`https://api.resource.test`)
2. Split the resource path into segments (`/content/dir3/file4`,
   `/content/dir3`, `/content`, `/`)
3. Check for an access token using the origin and the path, preferring
   the longest-matching path; for example if there is an access token
   stored with the path `/content`, then it would be found and used
   with the request

When the application obtains the access token via the exchange API,
the application should also compute and store the access token's expiration
date by adding the value of `access_token_max_seconds` to the current time.

For example:

```
const access_token_not_after_millis = Date.now() + (access_token_max_seconds * 1000);
```

## Multiple users and application settings

A multi-user application must keep a separate repository of access tokens
for each user and for its own configuration.

For example, if an application has users Alice and Bob, and both of them
authorize access to their own resources at `https://api.resource.test`,
there should be two separate access tokens stored, each one associated
with the user id in addition to origin and path.

When using a relational database to store access tokens, this could mean
a separate column. When using a flat database, this could mean creating
identifiers with a format like `${user_id}|${origin}|${path}`.

Access tokens that are part of application settings should be kept
separately from any user tokens. An application that uses
an authentication service, a spam filtering service, etc. that is
configured once and used with all users, would store its access token
for that resource in application settings instead of an individual
user setting. This is because if the access token is associated to the
administrator who obtained it, it wouldn't be usable when someone else
is logged in. Such application-wide access tokens could be stored in
a separate location or with an invalid user id like `#system` so they
cannot be accidentally used by a user with the same id.

## Exchange with refresh token

When the application loads an access token, the application checks the
stored expiration date (`access_token_not_after_millis` above). If the
access token expired, the application should use the exchange API to 
obtain a new one before proceding with the resource request.

The application sends a `POST` to the `webauthz_exchange_uri`
to exchange the refresh token for an access token and refresh token:

```
curl \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer 8ae505ee5afb9330396b11cb4290f00a48ac8b692863e6ba531b3f114707c9e8' \
  -X POST \
  --data '{"refresh_token": "f091c28660ac09b932aeeec047febc7f8060696bc33fb264"}' \
  'https://api.resource.test/webauthz/exchange'
```

The authorization server responds with:

```
HTTP/1.1 200 OK
Content-Type: application/json

{"access_token":"3d21c726822ef4b509322bef048595cdaf5ca2c0c7e6ff44","access_token_max_seconds":3600,"refresh_token":"f091c28660ac09b932aeeec047febc7f8060696bc33fb264","refresh_token_max_seconds":86400}
```

The response should be interpreted as discussed in [Exchange with grant token](#exchange-with-grant-token).
