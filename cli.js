#!/usr/bin/env node

var http = require('http');
var fs = require('fs');
var os = require('os');
var dgram = require('dgram');

var PROGRESS_BAR = Array(1000).join('=');
var WHITESPACE = Array(1000).join(' ');

var filename = process.argv[2];
var stat;

var MULTICAST_ADDRESS = '224.0.0.234';
var MULTICAST_PORT = 52525;

var transfers = [];
var monitor = function(stream, transfer) {
	var read = 0;
	var onend = function() {
		if (typeof transfer.progress !== 'number') {
			transfer.progress = 1;
		}
		transfer.status = '('+(transfer.progress < 1 ? '\033[22;31mfail\033[22;0m' : '\033[22;32mok\033[22;0m')+')    ';
		draw(true);
	};

	stream.on('data', function(data) {
		read += data.length;
		transfer.progress = read / transfer.length;
		transfer.status = '(\033[22;36m'+(100*transfer.progress).toFixed(1)+'%\033[22;0m)';
		draw();
	});
	stream.on('end', onend);
	stream.on('close', onend);

	transfers.push(transfer);
};
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
		var start = transfer.address+'';

		drawOffset++;
		start += WHITESPACE.slice(0, Math.max(1,16-start.length));
		console.error('\033[22;32mget\033[22;0m '+start+'['+PROGRESS_BAR.slice(0,progress)+'>'+WHITESPACE.slice(0,Math.max(0,width-progress))+'] '+transfer.status);
	});
};
var help = function(onanswer) {
	console.error('\033[22;32musage\033[22;0m \033[22;1mfileshare [filename]\033[22;0m')

	var sock = dgram.createSocket('udp4');
	var all = {};
	var kill = process.exit.bind(process);
	var timeout;

	sock.on('message', function(url) {
		url = url.toString();

		if (all[url]) return;
		all[url] = true;
		console.error('\033[22;32mfound\033[22;0m \033[22;1mcurl -LOC - '+url.split('@')[0]+'\033[22;0m (\033[22;36m'+url.split('@').pop().split('/')[0]+'\033[22;0m)');
		clearTimeout(timeout);
	});

	var send = function() {
		sock.send(new Buffer('get'), 0, 3, MULTICAST_PORT, MULTICAST_ADDRESS);
		timeout = setTimeout(kill, 1000);
	};
	var loop = setInterval(send, 1000);
	send();

};

if (!filename) return help();

try {
	stat = fs.statSync(filename);
} catch (err) {
	console.error('\033[22;31mfail\033[22;0m file does not exist');
	process.exit(1);
}
if (stat.isDirectory()) {
	console.error('\033[22;31mfail\033[22;0m you cannot share a directory');
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

var server = http.createServer();

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

	var stream = fs.createReadStream(filename, range);

	stream.pipe(res);

	res.on('close', function() {
		stream.destroy();
	});

	monitor(stream, {
		length: length,
		address: req.connection.remoteAddress
	});
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

	var sock = dgram.createSocket('udp4');

	sock.on('message', function(message, rinfo) {
		var url = new Buffer('http://'+addr+':'+port+'/'+name+'@'+os.hostname()+'/'+name);
		sock.send(url, 0, url.length, rinfo.port, rinfo.address);
	});
	sock.bind(MULTICAST_PORT);
	sock.addMembership(MULTICAST_ADDRESS);

	console.error('\033[22;32mshare this command:\033[22;0m \033[22;1mcurl -LOC - http://'+addr+':'+port+'/'+name);
});

server.listen(52525);
server.once('error', function() {
	server.listen(0);
});
