var express = require('express');
var querystring = require('querystring');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var request = require('request');
var socketio = require('socket.io');
var connectSocket = require('spotify-connect-ws');

var app = express();


app.use(cookieParser());
app.use(bodyParser.json());

var stateKey = 'spotify_auth_state';

// Retrieve environment variables
var client_id = process.env.CLIENT_ID;
var client_secret = process.env.CLIENT_SECRET;
var host = process.env.HOST;
var redirect_uri = host + '/callback';

// If env variables are not set, quit application with error exit code
if (!client_id || !client_secret || !host) {
  console.log("Error: Missing environment variables")
  process.exit(1);
}

// Set default port
app.set('port', process.env.PORT || 3000);

// Serve static js and css files
app.use(express.static(__dirname + '/public'));

// Set view folder and template engine
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
var generateRandomString = function(length) {
  var text = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

app.all('*', function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Cache-Control, Pragma, Origin, Authorization, Content-Type, X-Requested-With'
  );
  res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  next();
});

// Serves index template
app.get('/', function(req, res) {
  // Host config variable gets passed to client side script
  res.render('pages/index', {
    host: host
  });
});

// Redirects user to spotify authorization page
app.get('/login', function(req, res) {
  var state = generateRandomString(16);
  res.cookie(stateKey, state);
  // your application requests authorization
  var scope = 'user-read-playback-state';

  if (req.query.scope) {
    scope = req.query.scope;
  }

  res.redirect(
    'https://accounts.spotify.com/authorize?' +
      querystring.stringify({
        response_type: 'code',
        client_id: client_id,
        scope: scope,
        redirect_uri: redirect_uri,
        state: state
      })
  );
});

// Gets called by spotify backend for authorization
app.get('/callback', function(req, res) {
  // your application requests refresh and access tokens
  // after checking the state parameter

  var code = req.query.code || null;
  var state = req.query.state || null;
  var storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    // Unexpected diference in state of query and cookie
    console.log('state mismatch', 'state: ' + state, 'storedState ' + storedState, 'cookies ', req.cookies);
    res.status(500).send('State mismatch');
  } else {
    // Request access token
    res.clearCookie(stateKey);
    var authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code'
      },
      headers: {
        Authorization: 'Basic ' + new Buffer(client_id + ':' + client_secret).toString('base64')
      },
      json: true
    };

    request.post(authOptions, function(error, response, body) {
      if (!error && response.statusCode === 200) {
        // Redirect valid access token to client

        var access_token = body.access_token,
          refresh_token = body.refresh_token,
          expires_in = body.expires_in;

        // Store access token as cookie with 30 days age limit
        res.cookie('refresh_token', refresh_token, { maxAge: 30 * 24 * 3600 * 1000, domain: 'localhost' });

        res.redirect(`${host}/?refresh_token=${refresh_token}&access_token=${access_token}&expires_in=${expires_in}`);
      } else {
        console.log('wrong token');
        res.status(500).send('Wrong token');
      }
    });
  }
});

// Handler for requestion access token
app.post('/token', function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  var refreshToken = req.body ? req.body.refresh_token : null;
  if (refreshToken) {
    var authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      },
      headers: {
        Authorization: 'Basic ' + new Buffer(client_id + ':' + client_secret).toString('base64')
      },
      json: true
    };
    request.post(authOptions, function(error, response, body) {
      if (!error && response.statusCode === 200) {
        // Send valid access token to client

        var access_token = body.access_token,
          expires_in = body.expires_in;

        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify({ access_token: access_token, expires_in: expires_in }));
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify({ access_token: '', expires_in: '' }));
      }
    });
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ access_token: '', expires_in: '' }));
  }
});

// Initialize http server
var server = app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

// Initialize websockets
var io = socketio(server)
io.of('connect').on('connection', connectSocket.default);
