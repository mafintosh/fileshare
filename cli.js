#!/usr/bin/env node

var http = require('http');
var fs = require('fs');
var os = require('os');

var filename = process.argv[2];
var stat;

if (!filename) {
	console.error('filename needed');
	process.exit(1);
}

try {
	stat = fs.statSync(filename);
} catch (err) {
	console.error('file does not exist');
	process.exit(1);
}

var parseRange = function(header) {
	if (!header) return undefined;

	var parts = header.split('=').pop().split('-');
	var result = {};

	result.start = parseInt(parts[0],10);
	result.end = parseInt(parts[1],10);

	if (isNaN(result.end)) {
		result.end = stat.size-1;
	}
	if (isNaN(result.start)) {
		result.start = stat.size-result.end;
		result.end = stat.size-1;
	}

	result.length = result.end-result.start+1;
	return result;
};

var PROGRESS_BAR = Array(1000).join('=');
var WHITESPACE = Array(1000).join(' ');

var server = http.createServer();
var transfers = [];

var drawLast = 0;
var drawOffset = 0;
var draw = function(force) {
	var now = Date.now();
	if (!force && now-drawLast < 500) return;
	drawLast = now;
	var width = Math.min(process.stderr.columns, 60);
	process.stderr.moveCursor(0, -drawOffset);
	drawOffset = 0;
	transfers.forEach(function(transfer) {
		var progress = Math.floor(width*transfer.progress);
		var start = transfer.address+''//+' ('+transfer.status+'): ';

		start += WHITESPACE.slice(0, 16-start.length);
		console.error('\033[22;32mget\033[22;0m '+start+'['+PROGRESS_BAR.slice(0,progress)+'>'+WHITESPACE.slice(0,width-progress)+'] '+transfer.status);
		drawOffset++;
	});
	process.stderr.clearScreenDown();
};

server.on('request', function(req,res) {
	var range = parseRange(req.headers.range);
	var length = range ? range.length : stat.size;

	if (!range) {
		res.setHeader('Accept', 'Ranges');
		res.setHeader('Content-Length', length);
	} else if (range.length <= 0) {
		res.statusCode = 206;
		res.setHeader('Content-Length', 0);
		res.end();
		return;
	} else {
		res.statusCode = 206;
		res.setHeader('Content-Length', length);
		res.setHeader('Content-Range', 'bytes '+range.start+'-'+range.end+'/'+stat.size);
	}

	var transfer = {};
	var stream = fs.createReadStream(filename, range);
	var read = 0;

	stream.pipe(res);

	transfer.address = req.connection.remoteAddress;

	var onend = function() {
		transfer.status = '('+(transfer.progress < 1 ? '\033[22;31mfail\033[22;0m' : '\033[22;32mok\033[22;0m')+')    ';
		draw(true);
	};

	stream.on('data', function(data) {
		read += data.length;
		transfer.progress = read / length;
		transfer.status = '(\033[22;36m'+(100*transfer.progress).toFixed(1)+'%\033[22;0m)';
		draw();
	});
	stream.on('end', onend);
	res.on('close', onend);

	transfers.push(transfer);
});
server.on('listening', function() {
	var addr = os.networkInterfaces();
	var port = server.address().port;

	addr = Array.prototype.concat.apply([], Object.keys(addr).map(function(name) {
		return addr[name];
	})).filter(function(face) {
		return face.family === 'IPv4' && !face.internal;
	})[0].address;

	var name = filename.split('/').pop();
	var ext = filename.split('.').pop();
	
	name = encodeURIComponent(name) === name ? name : Date.now()+'.'+ext;

	console.error('\033[22;32mshare this command:\033[22;0m \033[22;1mcurl -LOC - http://'+addr+':'+port+'/'+name+'\033[22;0m');
});

server.listen(52525);
server.once('error', function() {
	server.listen(0);
});
