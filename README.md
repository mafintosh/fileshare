# fileshare

fileshare is a command line tool that lets you share a file on your local network

its available through npm:

	npm install -g fileshare

usage is simple:

	$ fileshare filename.ext
	$ share this command: curl -LOC - http://192.168.2.199:52525/filename.ext

receivers of the file simple need to run the curl command.  

	$ curl -LOC - http://192.168.2.199:52525/filename.ext # run this on the receiver to transfer the file	

if the transfer fails they can just run it again and curl will resume the transfer.