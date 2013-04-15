'use strict';
var assert = require('assert');

var packageRoot = __dirname + "/../..";

var libPath = function (modulePath) {
	return packageRoot + '/backend/lib' + modulePath;
};
var logPath = function (modulePath) {
	return libPath('/../../logs' + modulePath);
};
var loadLib = function (modulePath) {
	return require(libPath(modulePath));
};

var utils = loadLib('/utils');
var Config = loadLib('/config').Config;
//var assert = require('assert');
var AM = loadLib('/accounts/AccountManager');
var AccountManager = AM.AccountManager;

var mongoCodeConfig;
var mongoServer;

var mongoFileConfig = {
	"mongod": {
		"_handler": {
			"module": libPath('/mongo.js'),
			"namespace": ["Server"]
		},
		"hostName": "localhost",
		"port": 9099,
		"dbLocation": logPath('/db'),
		"_log": {
			"filePath": logPath("/mongo.log"),
			"level": "debug"
		}
	}
};

describe('AccountManager', function () {
	before(function (done) {
		mongoCodeConfig = new Config(mongoFileConfig, __dirname);
		mongoServer = new (mongoCodeConfig.loadConfig('mongod').handler)(mongoCodeConfig.loadConfig('mongod'));
		mongoServer.initialize(function (err) {
			if (err) throw err;
			mongoServer.start(function (err) {
				if (err) throw err;
				done();
			});
		});
	});

	after(function (done) {
		mongoServer.stop(function (err) {
			if (err) throw err;
			done();
		});
	});
	var singletonAM;
	var newAM = function (done) {
		if (!singletonAM)
			singletonAM = new AccountManager(function (err) {
				if (err) throw new Error(err);
				return done(null, singletonAM);
			}, "mongodb://localhost:9099", 'test_accountmanager', mongoServer.config.log);
		else {
			return done(null, singletonAM);
		}
	};

	var uname = 'uname_' + utils.generateUUID(16);
	var pass = 'pass_' + utils.generateUUID(16);
	it('Disallows login if uname and pass are random', function (done) {
		newAM(function (err, am) {
			if (err) throw err;
			am.login(function (err, acc) {
				if (acc) throw new Error('Account shouldnt be found');
				if (!(err instanceof AM.IncorrectCredentials)) throw new Error('Did not get expected error');
				done();
			}, uname, pass);
		});
	});

	var accCreated;
	it('Creates an account given a username and password', function (done) {
		newAM(function (err, am) {
			if (err) throw err;
			am.createAccount(function (err, acc) {
				if (err) throw new Error('Couldnt Create Account');
				accCreated = acc;
				done();
			}, uname, pass);
		});
	});

	it('Should be able to login with that account', function (done) {
		newAM(function (err, am) {
			am.login(function (err, accLoggedIn) {
				if (err || !accLoggedIn) throw new Error('Account shouldbe found');
				if (accCreated !== accLoggedIn) {
					var string = 'Did not get expected account ' + JSON.stringify({
						accCreated: {
							type: typeof(accCreated),
							data: accCreated
						},
						accLoggedIn: {
							type: typeof(accLoggedIn),
							data: accLoggedIn
						}
					});
					throw new Error(string);
				}
				done();
			}, uname, pass);
		});
	});

	it('Should not be able to create account with the same name again', function (done) {
		newAM(function (err, am) {
			am.createAccount(function (err, accCreated2) {
				if (accCreated2 || (err && !(err instanceof AM.UserExists))) {
					//console.log(err.constructor);
					throw err;
				}
				done();
			}, uname, pass);
		});
	});

	it('Should be able to delete account', function (done) {
		newAM(function (err, am) {
			if (err) throw err;
			am.deleteAccount(function (err) {
				if (err) throw err;
				done();
			}, uname, pass);
		});
	});
});

describe('API', function () {
	var async = require('async');
	var request = require('request');
	var servers = [];
	var apiConfig;
	before(function (done) {
		var config = (new Config()).rootConfig();
		//var len = config.metaConfig.linearOrdering;
		async.eachSeries(config.metaConfig.linearOrdering, function (con, cb) {
			//console.log(con);
			var server = new con.handler(con);
			servers.push(server);
			server.initialize(function (err) {
				cb(err);
			});
		}, function (err) {
			if (err) throw err;
			async.eachSeries(servers, function (server, cb) {
				server.start(function (err) {
					cb(err);
				});
			}, function (err) {
				if (err) throw err;
				done();
			});
		});
		apiConfig = config.loadConfig('api');
	});

	after(function () {
		async.eachSeries(servers, function (server, cb) {
			server.stop(cb);
		});
	});

	var uname = 'uname_' + utils.generateUUID(16);
	var pass = 'pass_' + utils.generateUUID(16);


	describe('Routes', function () {
		it('POST /accounts - Should Create an account', function (done) {
			var ep = apiConfig.uri;
			var opt = {
				url: ep + "/accounts",
				method: 'POST',
				form: null,
			};
			if (apiConfig.tls) {
				opt.ca = apiConfig.tls.certifyingAuthorities;
			}
			request.post(opt, function (err, res, body) {
				if (err) throw err;
				//console.log(res.headers, body);
				assert.strictEqual(res.statusCode, 201);
				assert.strictEqual(res.headers['content-type'], 'application/json');
				var jbody = JSON.parse(body);
				assert(typeof jbody.accountID === 'string');
				done();
			}).form({uname: uname, pass: pass});
		});

		it('POST /accounts - Should Fail creation with the same username', function (done) {
			var ep = apiConfig.uri;
			var opt = {
				url: ep + "/accounts",
				method: 'POST',
				form: null,
			};
			if (apiConfig.tls) {
				opt.ca = apiConfig.tls.certifyingAuthorities;
			}
			request.post(opt, function (err, res, body) {
				if (err) throw err;
				assert.strictEqual(res.statusCode, 409);
				assert.strictEqual(res.headers['content-type'], 'application/json');
				var jbody = JSON.parse(body);
				assert(jbody.message);
				done();
			}).form({uname: uname, pass: pass});
		});

		it('POST /sessions - Should Fail login with a random uname and pass', function (done) {
			var ep = apiConfig.uri;
			var opt = {
				url: ep + "/sessions",
				method: 'POST',
				form: null,
			};
			if (apiConfig.tls) {
				opt.ca = apiConfig.tls.certifyingAuthorities;
			}
			request.post(opt, function (err, res, body) {
				if (err) throw err;
				assert.strictEqual(res.statusCode, 409);
				assert.strictEqual(res.headers['content-type'], 'application/json');
				var jbody = JSON.parse(body);
				assert(jbody.message);
				done();
			}).form({uname: 'uname', pass: 'pass'});
		});
		var authInfo;
		it('POST /sessions - Should succeed login with the right username and password', function (done) {
			var ep = apiConfig.uri;
			var opt = {
				url: ep + "/sessions",
				method: 'POST',
				form: null,
			};
			if (apiConfig.tls) {
				opt.ca = apiConfig.tls.certifyingAuthorities;
			}
			request.post(opt, function (err, res, body) {
				if (err) throw err;
				assert.strictEqual(res.statusCode, 201);
				assert.strictEqual(res.headers['content-type'], 'application/json');
				var jbody = JSON.parse(body);
				assert(jbody.sessionID);
				assert(typeof jbody.sessionID, 'string');
				authInfo = jbody.sessionID;
				done();
			}).form({uname: uname, pass: pass});
		});

		it('GET /sessions - Should fail with the wrong token', function (done) {
			var ep = apiConfig.uri;
			var opt = {
				url: ep + "/sessions",
				method: 'GET',
				headers: {
					Authorization: 'Celebration ' + utils.generateUUID(authInfo.length),
				},
			};
			if (apiConfig.tls) {
				opt.ca = apiConfig.tls.certifyingAuthorities;
			}
			request.get(opt, function (err, res, body) {
				if (err) throw err;
				assert.strictEqual(res.statusCode, 401);
				assert.strictEqual(res.headers['content-type'], 'application/json');
				var jbody = JSON.parse(body);
				assert(jbody.message);
				done();
			});
		});


		it('HEAD /sessions - Should fail with the wrong token', function (done) {
			var ep = apiConfig.uri;
			var opt = {
				url: ep + "/sessions",
				method: 'HEAD',
				headers: {
					Authorization: 'Celebration ' + utils.generateUUID(authInfo.length),
				},
			};
			if (apiConfig.tls) {
				opt.ca = apiConfig.tls.certifyingAuthorities;
			}
			request.get(opt, function (err, res) {
				if (err) throw err;
				assert.strictEqual(res.statusCode, 401);
				assert.strictEqual(res.headers['content-type'], 'application/json');
				done();
			});
		});

		it('GET /sessions/:sessionID - Should succeed with the right token', function (done) {
			var ep = apiConfig.uri;
			var opt = {
				url: ep + "/sessions" + "/" + authInfo,
				method: 'GET',
				headers: {
					Authorization: 'Celebration ' + authInfo,
				},
			};
			if (apiConfig.tls) {
				opt.ca = apiConfig.tls.certifyingAuthorities;
			}
			request.get(opt, function (err, res, body) {
				if (err) throw err;
				assert.strictEqual(res.statusCode, 200);
				assert.strictEqual(res.headers['content-type'], 'application/json');
				var jbody = JSON.parse(body);
				assert(jbody.sessionID);
				assert.strictEqual(jbody.sessionID, authInfo);
				done();
			});
		});

		it('HEAD /sessions/:sessionID - Should succeed with the right token', function (done) {
			var ep = apiConfig.uri;
			var opt = {
				url: ep + "/sessions" + "/" + authInfo,
				method: 'HEAD',
				headers: {
					Authorization: 'Celebration ' + authInfo,
				},
			};
			if (apiConfig.tls) {
				opt.ca = apiConfig.tls.certifyingAuthorities;
			}
			request.get(opt, function (err, res) {
				if (err) throw err;
				assert.strictEqual(res.statusCode, 200);
				done();
			});
		});
		it('GET /sessions - Should succeed with the right token', function (done) {
			var ep = apiConfig.uri;
			var opt = {
				url: ep + "/sessions",
				method: 'GET',
				headers: {
					Authorization: 'Celebration ' + authInfo,
				},
			};
			if (apiConfig.tls) {
				opt.ca = apiConfig.tls.certifyingAuthorities;
			}
			request.get(opt, function (err, res, body) {
				if (err) throw err;
				assert.strictEqual(res.statusCode, 200);
				assert.strictEqual(res.headers['content-type'], 'application/json');
				var jbody = JSON.parse(body);
				assert(jbody.sessions);
				assert.strictEqual(jbody.sessions[0].sessionID, authInfo);
				done();
			});
		});

		it('HEAD /sessions - Should succeed with the right token', function (done) {
			var ep = apiConfig.uri;
			var opt = {
				url: ep + "/sessions",
				method: 'HEAD',
				headers: {
					Authorization: 'Celebration ' + authInfo,
				},
			};
			if (apiConfig.tls) {
				opt.ca = apiConfig.tls.certifyingAuthorities;
			}
			request.get(opt, function (err, res) {
				if (err) throw err;
				assert.strictEqual(res.statusCode, 200);
				done();
			});
		});
	});
});