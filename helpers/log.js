let fs = require('fs');
if (!fs.existsSync('./logs')) {
	fs.mkdirSync('./logs');
}

let infoStr = fs.createWriteStream('./logs/' + date() + '.log', {
	flags: 'a'
});

infoStr.write(`\n\n[The bot started] _________________${fullTime()}_________________\n`);

module.exports = {
	error(str) {
		infoStr.write(`\n ` + 'error|' + fullTime() + '|' + str);
		console.log('\x1b[31m', 'error|' + fullTime(), '\x1b[0m', str);
	},
	info(str) {
		console.log('\x1b[32m', 'info|' + fullTime(), '\x1b[0m', str);
		infoStr.write(`\n ` + 'info|' + fullTime() + '|' + str);
	},
	warn(str) {
		console.log('\x1b[33m', 'warn|' + fullTime(), '\x1b[0m', str);
		infoStr.write(`\n ` + 'warn|' + fullTime() + '|' + str);
	},
	log(str) {
		console.log('\x1b[34m', 'log|' + fullTime(), '\x1b[0m', str);
		infoStr.write(`\n ` + 'log|[' + fullTime() + '|' + str);
	}
};

function time() {
	var options = {
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric'
	};

	return new Date().toLocaleString('en-GB', options);
}

function date() {
	var options = {
		year: 'numeric',
		month: 'numeric',
		day: 'numeric'
	};
	return (new Date().toLocaleString('fr-CA', options)).replace(/\//g, '-');
}

function fullTime() {
	return date() + ' ' + time();
}
