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


function redisConnect(host, port) {
  port = port || 6379;
  host = host || 'localhost';
  return redisWrapper(redis.createClient(port, host));
}

function *resqueFailureCount(client) {
  return yield client.llen('resque:failed');
}


function *checker(serviceName, fn, predicate, errorfn) {
  var result = {};
  // result.error = serviceName;  // uncomment to force errors
  try {
    var val = yield fn();
    //logm('val: ',val)
    if (predicate(val)) {
      result.msg = serviceName + ' is okay';
    } else {
      result.error = serviceName + errorfn(val);
    }
  } catch(err) {
    result.error = serviceName + ' has error: ' + err;
  }
  return result;
}

function *resqueHealthCheck() {
  function fn(){ return resqueFailureCount(redisClient) };
  return yield checker('resque', fn, v=>+v===0, v=>' has '+v+' errors.')
}

function *summitHealthCheck() {
  function fn(){ return request('https://www.summit.com/locations') };
  function pred(res){ return res && res.statusCode===200 && res.body.match(/Sulphur/)}
  function err(res){ return 'summit is down; could not find location. ('+res.statusCode+')'}
  return yield checker('summit', fn, pred, err)
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



var errorMsg = _.prop('error')
var getErrors = _.compose(_.pickBy((val,key)=>val), _.mapObjIndexed(errorMsg))


var redisClient = redisConnect(process.env.redis_host, process.env.redis_port)

function *checkAll() {
  var result = {};
  result.resque = yield resqueHealthCheck();
  result.summit = yield summitHealthCheck();

  //logm('result: ', result);
  var errors = getErrors(result);
  logm('errors: ', errors);

  if (Object.keys(errors).length > 0) {
    sendAlert(JSON.stringify(errors)).catch(log);
  }
};

co(function *() {
  while(true) {
    try {
      yield checkAll();
    } catch(err) {
      log('checkAll caused an error: ' + err);
    }
    log('finished checkAll ' + new Date());
    yield sleep(runFrequency * 60 * 1000);
  }
}).catch(function(e){log('oh no, it crashed'); log(e)});

/*
sendAlert('testing')
  .then(msg => logm('yay', msg))
  .catch(msg => logm('boo', msg));

*/
