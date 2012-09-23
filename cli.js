#!/usr/bin/env node

var fs = require('fs');
var os = require('os');
var http = require('http');
var dgram = require('dgram');
var url = require('url');

var PROGRESS_BAR = Array(1000).join('=');
var WHITESPACE = Array(1000).join(' ');
var MULTICAST_ADDRESS = '224.0.0.234';
var MULTICAST_PORT = 52525;

var draw = function() {
	var that = {};
	var offset = 0;
	var lastClear = 0;

	var ansi = {
		green:'32m',
		red:'31m',
		bold:'1m',
		blue:'36m'
	};

	var colorPattern = /\@([^\(]+)\(([^\)]+)\)/g;
	var color = function(_, val, str) {
		return '\033[22;'+ansi[val]+str+'\033[22;0m';
	};

	that.wait = function() {
		return Date.now() - lastClear < 500;
	};
	that.clear = function() {
		lastClear = Date.now();
		process.stdout.moveCursor(0, -offset);
		process.stdout.clearScreenDown();
		offset = 0;
	};
	that.log = function(line) {
		console.log(line.replace(colorPattern, color).replace(colorPattern, color));
	};
	that.line = function(line) {
		offset++;
		that.log(line);
	};
	return that;
}();

var choose = function(header, onchoose) {
	if (!onchoose) return choose(null, header);

	var lines = [];
	var datas = [];
	var index = 0;
	var update = function() {
		draw.clear();
		if (header) {
			draw.line(header);		
		}
		lines.forEach(function(line, i) {
			draw.line('['+(i === index ? '@blue(x)' : ' ')+'] '+line);
		});
	};

	process.stdin.setRawMode(true);
	process.stdin.on('data', function ondata(data) {
		data = data.toString('hex');
		if (data === '03') return process.exit(0);
		if (data === '1b5b41') {
			index = Math.max(0, index - 1);
			update();
		}
		if (data === '1b5b42') {
			index = Math.min(lines.length-1, index+1);
			update();
		}
		if (data === '0d') {
			process.stdin.removeListener('data', ondata);
			onchoose(datas[index]);
			process.stdin.setRawMode(false);
		}
	});
	process.stdin.resume();

	return function(line, data) {
		lines.push(line);
		datas.push(data || line);
		update();
	};
};

var monitor = function() {
	var streams = [];
	var update = function(force) {
		if (!force && draw.wait()) return;
		draw.clear();
		streams.forEach(function(stream) {
			var padding = WHITESPACE.slice(0, Math.max(0,16-stream.address.length));
			var progressWidth = Math.floor(stream.progress*40);
			var progressBar = '['+PROGRESS_BAR.slice(0, progressWidth)+'>'+WHITESPACE.slice(0, 40-progressWidth)+']';
			draw.line('@green(get) '+stream.address+' '+padding+progressBar+' '+stream.status);
		});
	};

	return function(options) {
		var read = 0;
		options.progress = 0;
		options.stream.on('data', function(data) {
			read += data.length;
			options.progress = read / options.length;
			options.status = '(@blue('+(100*options.progress).toFixed(1)+'%))';
			update();
		});
		options.stream.on('end', function() {
			options.progress = 1;
			options.status = '(@green(ok))';
			update(true);
		});
		options.stream.on('close', function() {
			if (options.progress === 1) return;
			options.status = '(@read(fail))';
			update(true);
		});
		streams.push(options);
	};
};

var put = function(filename) {
	var stat;

	try {
		stat = fs.statSync(filename);
	} catch (err) {
		draw.line('@red(fail) file does not exist');
		process.exit(1);
	}
	if (stat.isDirectory()) {
		draw.line('@red(fail) you cannot share a directory');
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
	var mon = monitor();

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

		mon({
			stream:stream,
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
		})[0];
		addr = addr && addr.address;

		if (!addr) {
			draw.line('@red(fail) you are not connected to a network');
			process.exit(1);
		}

		var name = filename.split('/').pop();
		var ext = filename.split('.').pop();
		
		name = encodeURIComponent(name) === name ? name : Date.now()+'.'+ext;

		var sock = dgram.createSocket('udp4');

		sock.on('message', function(message, rinfo) {
			var url = new Buffer('http://'+addr+':'+port+'/'+name+'@'+os.hostname());
			sock.send(url, 0, url.length, rinfo.port, rinfo.address);
		});
		sock.bind(MULTICAST_PORT);
		sock.addMembership(MULTICAST_ADDRESS);

		draw.log('@green(share this command:) @bold(curl -LOC - http://'+addr+':'+port+'/'+name+')');
	});

	server.listen(52525);
	server.once('error', function() {
		server.listen(0);
	});
};
var get = function(file) {
	var stat = fs.existsSync(file.filename) && fs.statSync(file.filename);
	var mon = monitor();

	if (stat && stat.isDirectory())  {
		draw.clear();
		draw.line('@red(fail) output file is a directory');
		process.exit(1);
	}
	if (stat) {
		file.headers = {};
		file.headers.range = 'bytes='+(stat.size)+'-';
	}
	http.get(file, function(res) {
		var dest = fs.createWriteStream(file.filename, {flags:(stat ? 'r+' : 'w')});

		mon({
			address:file.from+'/'+file.filename,
			length:parseInt(res.headers['content-length'],10),
			stream:res
		});

		res.pipe(dest);
		res.on('end', function() {
			setTimeout(process.exit.bind(process, 0), 1000);
		});
	});
};
var find = function(onfind) {
	var sock = dgram.createSocket('udp4');
	var prev = {};

	sock.on('message', function(message, rinfo) {
		message = message.toString();
		if (prev[message]) return;
		prev[message] = true;
		var from = message.split('@').pop();
		var parsed = url.parse(message.split('@')[0]);
		onfind({
			host:parsed.host.split(':')[0],
			port:parseInt(parsed.host.split(':')[1],10),
			path:parsed.path,
			filename:parsed.path.split('/').pop(),
			from:from
		});
	});

	var send = function() {
		sock.send(new Buffer('get'), 0, 3, MULTICAST_PORT, MULTICAST_ADDRESS);	
	};
	var loop = setInterval(send, 1000);
	send();

	return function() {
		sock.removeAllListeners('message');
		sock.close();
		clearInterval(loop);
	};
};
var help = function() {
	draw.line('@green(you are running) @bold(fileshare) @green(version) @bold('+require('./package.json').version+')');
	draw.line('');
	draw.line('@bold(fileshare [filename]) @green(share a file on the network)');
	draw.line('@bold(fileshare ls)         @green(list all files on the network)');
	draw.line('@bold( )                    @green(select one to download it)');
	draw.line('');
	process.exit(0);
};

if (!process.argv[2]) return help();

var cmds = {};

cmds.default = function() {
	put(process.argv[2]);
};
cmds.ls = function() {
	var update = choose(function(file) {
		destroy();
		get(file);
	});

	var wait = setTimeout(function() {
		draw.line('@red(fail) no files found');
		process.exit(1);
	}, 1500);

	var destroy = find(function(file) {
		clearTimeout(wait);
		update('@green(get) '+file.from+file.path, file);
	});
};

(cmds[process.argv[2]] || cmds.default)();