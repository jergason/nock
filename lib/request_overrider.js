var IncomingMessage = require('http').IncomingMessage;

function stringifyRequest(options, body) {
  var method = options.method || 'GET',
      path = options.path;

  if (body && typeof(body) !== 'string') {
    body = body.toString();
  }
  return method + ' ' + path + ' ' + body;
}

function getHeader(request, name) {
  if (!request._headers) return;

  var key = name.toLowerCase();

  return request._headers[key];
}

function setHeader(request, name, value) {
  var key = name.toLowerCase();

  request._headers = request._headers || {};
  request._headerNames = request._headerNames || {};
  request._headers[key] = value;
  request._headerNames[key] = name;
}

function isStream(obj) {
  var is = obj && (typeof a !== 'string') && (! Buffer.isBuffer(obj)) && (typeof obj.setEncoding == 'function');
  return is;
}

function RequestOverrider(req, options, interceptors, remove) {
  var response = new IncomingMessage(),
      requestBodyBuffers = [],
      aborted,
      end,
      ended,
      headers,
      keys,
      key,
      i,
      l;

  if (options.headers) {
    headers = options.headers;
    keys = Object.keys(headers);

    for (i = 0, l = keys.length; i < l; i++) {
      key = keys[i];

      setHeader(req, key, headers[key]);
    };
  }

  options.getHeader = function(name) {
    return getHeader(req, name);
  };

  if (options.host && !getHeader(req, 'host')) {
    var hostHeader = options.host;

    if (options.port === 80 || options.port === 443) {
      hostHeader = hostHeader.split(':')[0];
    }

    setHeader(req, 'Host', hostHeader);
  }

  req.write = function(buffer, encoding) {
    if (buffer && !aborted) {
      if (! Buffer.isBuffer(buffer)) {
        buffer = new Buffer(buffer, encoding);
      }
      requestBodyBuffers.push(buffer);
    }
  };
  
  req.end = function(buffer, encoding) {
    if (!aborted && !ended) {
      req.write(buffer, encoding);
      end();
      req.emit('end');
    }
  };
  
  req.abort = function() {
    aborted = true;
    if (!ended) {
      end();
    }
    var err = new Error();
    err.code = 'aborted'
    response.emit('close', err);
  };
  
  end = function() {
    ended = true;
    var encoding,
        requestBody,
        responseBody,
        interceptor,
        paused,
        next = [];

    var requestBodySize = 0;
    var copyTo = 0;
    requestBodyBuffers.forEach(function(b) {
      requestBodySize += b.length;
    });
    requestBody = new Buffer(requestBodySize);
    requestBodyBuffers.forEach(function(b) {
    b.copy(requestBody, copyTo);
      copyTo += b.length;
    });
    
    requestBody = requestBody.toString();
    
    interceptors = interceptors.filter(function(interceptor) {
      return interceptor.match(options, requestBody);
    });
    
    if (interceptors.length < 1) { throw new Error("Nock: No match for HTTP request " + stringifyRequest(options, requestBody)); }
    interceptor = interceptors.shift();

    response.statusCode = interceptor.statusCode || 200;
    response.headers = interceptor.headers || {};

    if (typeof interceptor.body === 'function') {
        responseBody = interceptor.body(options.path, requestBody) || '';
    } else {
        responseBody = interceptor.body;
    }

    if (isStream(responseBody)) {
      responseBody.on('data', function(d) {
        response.emit('data', d);
      });
      responseBody.on('end', function() {
        response.emit('end');
      });
      process.nextTick(function() {
        responseBody.resume();
      });
    } else  if (responseBody && !Buffer.isBuffer(responseBody)) {
      responseBody = new Buffer(responseBody);
    }
    response.setEncoding = function(newEncoding) {
      encoding = newEncoding;
    };
    remove(interceptor);
    interceptor.discard();

    if (aborted) { return; }

    response.pause = function() {
      paused = true;
      if (isStream(responseBody)) {
        responseBody.pause();
      }
    };

    response.resume = function() {
      paused = false;
      if (isStream(responseBody)) {
        responseBody.resume();
      }
      callnext();
    };

    next.push(function() {
      if (encoding) {
        if (isStream(responseBody)) {
          responseBody.setEncoding(encoding);
        } else {
          responseBody = responseBody.toString(encoding);
        }
      }
      if (! isStream(responseBody)) {
        response.emit('data', responseBody);
      }
    });

    if (! isStream(responseBody)) {
      next.push(function() {
        response.emit('end');
      });
    }

    function callnext() {
      process.nextTick(function() {
      if (paused || next.length === 0 || aborted) { return; }
        next.shift()();
        callnext();
      });
    };
    
    process.nextTick(function() {
      if (typeof callback === 'function') {
        callback(response);
      }
      req.emit('response', response);
      callnext();
    });
  };

  return req;
}

module.exports = RequestOverrider;
