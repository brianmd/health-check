'use-static';

const koa  = require('koa');
const checker = require('./checker');

const app = koa();

app.context.checker = checker;
checker.run();

app.use(function *(next) {
  this.body = checker.observation;
})

module.exports = app;
