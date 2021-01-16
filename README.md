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
