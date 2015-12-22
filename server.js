'use-static';

const port = 3007;

const app = require('./app');

app.listen(port);
console.log('listening at http://localhost:' + port + '/');

