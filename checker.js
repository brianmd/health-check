'use-strict';

/*
 * Unable to close the smtp server.
 * Don't want to leave it open because expectation is
 * nothing should be sent for days.
 * Am hoping it will close during garbage collection,
 */

const runFrequency = +process.env.frequency || 5; // minutes

const co      = require('co');
const email   = require('emailjs');
const _       = require('ramda');
const redis   = require('redis');
const redisWrapper = require('co-redis');
const request = require("co-request");
const sleep   = require('co-sleep');

const errorMsg = _.prop('error')
const getErrors = _.compose(_.pickBy((val,key)=>val), _.mapObjIndexed(errorMsg))
const log  = (x)      => { console.log(JSON.stringify(x, null, 2)); return x };
const logm = (msg, x) => { console.log(msg, x); return x };
const methodNames = _.compose(_.keys, _.pickBy(_.is(Function)));

const smtpConfig = {
  user:    process.env.smtp_username,
  password:process.env.smtp_password,
  host:    process.env.smtp_address,
  port:    process.env.smtp_port,
  tls:     {ciphers: "SSLv3"}
};


const redisClient = redisConnect(process.env.redis_host, process.env.redis_port, process.env.redis_password);
const observation = {};


function run() {
  co(looper())
    .catch(e => {
      log('oh no, it crashed');
      log(e)
    });
}

function *looper() {
  while(true) {
    try {
      yield checkServices();
    } catch(err) {
      log('checkServices caused an error: ' + err + '\n    at ' + new Date());
    }
    yield sleep(runFrequency * 60 * 1000);
  }
}

function *resqueHealthCheck() {
  function fn(){ return resqueFailureCount(redisClient) };
  return yield checkService('resque', fn, v=>+v===0, v=>' has '+v+' errors.')
}

function *bhHealthCheck() {
  function fn(){ return request('https://www.summit.com/locations') };
  function pred(res){ return res && res.statusCode===200 && res.body.match(/Sulphur/)}
  function err(res){ return 'is down; could not find location. ('+res.statusCode+')'}
  return yield checkService('bh', fn, pred, err)
}

function *papiHealthCheck() {
  var req = {
    'uri': process.env.papichulo_url,
    'auth': {
      'user': process.env.papichulo_username,
      'pass': process.env.papichulo_password
    }
  }
  function fn(){ return request.get(req) }

  function pred(res){ return res && res.statusCode===200 && res.body.match(/app_name/)}
  function err(res){ return 'is down; could not find app_name. ('+res.statusCode+')'}
  return yield checkService('papi', fn, pred, err)
}



//    helper functions

function *checkServices() {
  var result = {};
  result.resque = yield resqueHealthCheck();
  result.bh = yield bhHealthCheck();
  result.papi = yield papiHealthCheck();

  //logm('result: ', result);
  var errors = getErrors(result);
  logm(new Date()+' errors: ', errors);

  observation.result = result;
  observation.errors = errors;
  observation.date   = new Date();

  if (Object.keys(errors).length > 0) {
    sendAlert(JSON.stringify(errors)).catch(log);
  }
};




function *checkService(serviceName, fn, predicate, errorfn) {
  var result = {};
  // result.error = serviceName;  // uncomment to force errors
  try {
    var val = yield fn();
    //logm('val: ',val)
    if (predicate(val)) {
      result.msg = serviceName + ' is okay';
    } else {
      result.error = serviceName + ' ' + errorfn(val);
    }
  } catch(err) {
    result.error = serviceName + ' has error: ' + err;
  }
  return result;
}

function redisConnect(host, port, pass) {
  port = port || 6379;
  host = host || 'localhost';
  pass = pass || null;
  return redisWrapper(redis.createClient(port, host, {auth_pass: pass}));
}

function *resqueFailureCount(client) {
  return yield client.llen('resque:failed');
}

function sendAlert(msg) {
  return new Promise((resolve, reject) => {
      var server  = email.server.connect(smtpConfig);
  server.send({
    text:    msg,
    from:    'test@example.com',
    to:      process.env.alert_emails,
    subject: "summit alert"
  }, function(err, message) {

    // should close smtp server, but no such method
    // will eventually get garbage collected and presumably
    // close then.

    if (err)
      reject(err)
    else
      resolve(message);
  });
});
};

module.exports = {
  run: run,
  looper: looper,
  checkServices: checkServices,
  observation: observation
}
