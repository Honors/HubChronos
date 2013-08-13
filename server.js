var https = require('https'),
	fs = require('fs'),
	http = require('http');

var PORT = 8080;
console.log('Initiating Server on Port '+PORT);

// Functional Prelude
var attr = function(k) {
	return function(item) {
		return item[k];
	};
};
var toAssoc = function(obj) {
	return Object.keys(obj).map(function(k) {
		return [k,obj[k]];
	});
};
var fromAssoc = function(arr) {
	var obj = {}; 
	arr.map(function(b){
		obj[b[0]] = b[1];
	}); 
	return obj;
};

var getRepos = function(user, password, cb, orgname) {
	// Get Repos of Either `user` or `orgname`, Authenticated as User.
	var req = https.request({
		host: "api.github.com",
		path: "/users/"+(orgname||user)+"/repos?per_page=100",
		method: "GET",
		headers: {
			'Authorization': 'Basic ' + new Buffer(user + ':' + password).toString('base64')
		}
	}, function(res) {
		var buffer = [];
		res.on("data", function(chunk) {
			buffer.push(chunk);
		});
		res.on("end", function() {
			var repos = JSON.parse(buffer.join(""));
			cb(repos.map(attr('full_name')));
		});
	});
	req.end();
};
var getRepoCommits = function(repo, username, password, cb) {
	// Get the Commits to a Certain Repo, Authenticated as `username`
	var req = https.request({
		host: "api.github.com",
		path: "/repos/"+repo+"/commits?per_page=1000",
		method: "GET",
		headers: {
			'Authorization': 'Basic ' + new Buffer(username + ':' + password).toString('base64')
		}
	}, function(res) {
		var buffer = [];
		res.on("data", function(chunk) {
			buffer.push(chunk);
		});
		res.on("end", function() {
			// Filter Commits for the Authenticating User
			var commits = JSON.parse(buffer.join(""));
			commits = commits.filter(function(commit) {
				if( !commit.author ) return false;
				if( !commit.author.login ) return false;
				return commit.author.login == username;
			});
			// Form a History, consisting of Date-Times of Each Commit
			var history = commits.map(function(commit) {
				var date = new Date(commit.commit.author.date);
				return {
					day: [date.getMonth()+1, date.getDate(), date.getYear()+1900].join('/'), 
					time: [date.getHours(), (1e5+''+date.getMinutes()).slice(-2)].join(':')
				};
			});
			// Form a Calendar with Commits Per Day
			var days = {};
			history.forEach(function(commit) {
				days[commit.day] = days[commit.day] || [];
				days[commit.day].push(commit.time);
			});	
			cb(days);		
		});
	});	
	req.end();
};	
var render = function(json) {
	// Output and Save a Dumped Fetch
	console.log(json);
	fs.writeFile(__dirname + '/dump.json', JSON.stringify(json));	
};
var handleCommits = function(username, password, cb, orgname) {
	// Wraps a Commit Fetch to Get Repos then Commits and 
	// Render Them as Repo-Commits Hashes.
	var	history = [];
	// Get Organization Repos...
	getRepos(username, password, function(repos) {
		var finished = [];
		repos.map(function(repo) {
			// Get Commits...
			getRepoCommits(repo, username, password, function(days) {
				finished.push(repo);
				days = toAssoc(days);
				history.push({
					repo: repo,
					commit_days: fromAssoc(days.map(function(day) {
						return [day[0], day[1].length];
					}))
				});
				// When All Have Been Fetched...
				if( finished.length == repos.length ) {
					cb(history);
				}
			});
		});
	}, orgname);
};
var dumpCommits = function(username, password, orgs, accum) {
	// Render Commits, Either of Organization and
	// Individual, or Just Individual
	accum = accum || []
	if( orgs.length == 1 ) {
		handleCommits(username, password, function(A) {
			handleCommits(username, password, function(B) {
				render(accum.concat(A).concat(B));
			});	
		}, orgs[0]);
	} else if( orgs.length ) {
		handleCommits(username, password, function(A) {
			dumpCommits(username, password, orgs.slice(1), accum.concat(A));
		}, orgs[0]);
	} else {
		handleCommits(render)
	}
};

// Read in Credits
var creds = JSON.parse(fs.readFileSync(__dirname + '/creds.json')),
	username = creds.username,
	password = creds.password,
	organizations = creds.organizations;

http.createServer(function(req, res) {
	if( req.url == '/dump' ) {
		// Return the Dumped Data
		res.writeHead(200, {'Content-Type': 'text/json'});
		fs.createReadStream(__dirname + '/dump.json').pipe(res);
	} else if( req.url == '/fetch' ) {
		// Fetch New Data and Dump
		dumpCommits(username, password, organizations);
		res.end("Fetching Commits.");
	} else {
		// Render the Example Page
		res.writeHead(200, {'Content-Type': 'text/html'});
		fs.createReadStream(__dirname + '/example.html').pipe(res);
	}
}).listen(PORT);