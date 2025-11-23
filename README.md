

Setup

follow https://google.github.io/adk-docs/get-started/python/  to install google adk

choose a gemini 2.5 flash and Google AI when prompted in terminal

grab api key from ai studio - https://aistudio.google.com/api-keys


auth for google calendar

- go to https://console.cloud.google.com/auth/clients
- create a new client
- create a new OAuth 2.0 client ID
- choose web application as application type
- add as Authorized JavaScript origins: http://localhost:8000, http://localhost
- add as Authorized redirect URIs: http://127.0.0.1:8000/dev-ui/
- grab client and secret; add it to .env file
- save
- wait for about 5 minutes lol

run adk web to test agent
- test query: "what are my upcoming events for today?"
- it should prompt auth, choose your google account (click allow)
- after auth, it should return your events



canvas lms mcp
- https://github.com/DMontgomery40/mcp-canvas-lms
- go to your canvas account
- your profile -> settings -> API keys -> New Access Token
- copy token and add it to .env file


integrating canvas mcp with adk
- https://google.github.io/adk-docs/tools-custom/mcp-tools/#example-1-file-system-mcp-server
- this guide provides a good overview of how to set up a mcp server with adk


in our code, we filter out the tools we don't want to expose to the agent 
- this is because some tools are not safe to expose to the agent
- also saves tokens

