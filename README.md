# fileshare

fileshare is a command line tool that lets you share and discover files on your local network

Its available through npm:

	npm install -g fileshare

## How do I use it?

Usage is simple:

	$ fileshare filename.ext
	$ share this command: curl -LOC - http://192.168.2.199:52525/filename.ext

Receivers of the file simple need to run the curl command.  

	$ curl -LOC - http://192.168.2.199:52525/filename.ext # run this on the receiver to transfer the file	

If the transfer fails they can just run it again and curl will resume the transfer.

To list all available files available for download on the network do

	$ fileshare ls
	$ [x] get someone/filename.ext
	$ [ ] get someone-else/filename.ext

Select the file you want using `up` and `down` on your keyboard and click `enter`

## I want to share files on the web?

fileshare only works on the local network.  
To share files with anyone, anywhere use [Ge.tt](http://ge.tt/)