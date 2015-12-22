'use-strict';

co      = require('co');
checker = require('./checker');

co(checker.looper()).catch(function(e){log('oh no, it crashed'); log(e)});;

