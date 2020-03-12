let fs = require('fs');
if (!fs.existsSync('./logs')) {
	fs.mkdirSync('./logs');
}

let infoStr = fs.createWriteStream('./logs/' + date() + '.log', {
	flags: 'a'
});

infoStr.write(`
_________________${fullTime()}_________________
`);

module.exports = {
	error(str) {
		infoStr.write(`
		` + 'Bot error|' + time() + '|' + str);
		console.log('\x1b[31m', 'error|' + time(), '\x1b[0m', str);
	},
	info(str) {
		console.log('\x1b[32m', 'info|' + time(), '\x1b[0m', str);

		infoStr.write(`
		` + 'Bot info|' + time() + '|' + str);
	},
	warn(str) {
		console.log('\x1b[33m', 'warn|' + time(), '\x1b[0m', str);

		infoStr.write(`
		` + 'Bot warn|' + time() + '|' + str);
	},
	log(str) {
		console.log('\x1b[34m', 'log|' + time(), '\x1b[0m', str);

		infoStr.write(`
		` + 'Bot log|[' + time() + '|' + str);
	}
};

function time() {
	var options = {
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric'
	};

	return new Date().toLocaleString('en', options);
}

function date() {
	var options = {
		day: 'numeric',
		month: 'numeric',
		year: 'numeric'
	};
	return (new Date().toLocaleString('en', options)).replace(/\//g, '-');
}

function fullTime() {
	return date() + ' ' + time();
}
