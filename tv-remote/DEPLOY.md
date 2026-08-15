# Running it somewhere permanent

## Why GitHub Pages can't host this

GitHub Pages — and Netlify, Vercel's static tier, S3, any static host — serves
files. It doesn't run a server process. This app needs one, because something
has to hold open a WebSocket to your TV and speak its protocol.

The tempting workaround is to move all the logic into the browser and let the
phone talk to the TV directly, with Pages just serving the HTML. That doesn't
work either, for four independent reasons — any one of them is fatal:

1. **Mixed content.** Pages is HTTPS-only. Your TV is at
   `http://192.168.1.42`. Browsers refuse HTTPS→HTTP subresource requests and
   there is no opt-out.
2. **CORS.** Roku, Samsung and the rest send no `Access-Control-Allow-Origin`
   header, so the browser blocks the response even when the request goes out.
3. **Private Network Access.** Chrome blocks a public-origin page from reaching
   private IP ranges at all.
4. **Self-signed certs.** Samsung (`wss://…:8002`) and Vizio
   (`https://…:7345`) use certificates no browser will accept, with no way to
   click through for a background request.

This isn't a quirk of how it's built. Anything that controls a device on your
LAN needs code running *on* your LAN. It's why Plex, Home Assistant and Sonos
all ship a local server rather than a pure web app.

So the question isn't *where to deploy it* — it's **what machine at home keeps
it running**.

---

## Option A — a machine at home (the normal answer)

Anything always-on and on the same WiFi: a Raspberry Pi, a NAS, a Mac mini, an
old laptop with the lid-close action set to "do nothing".

**Linux / Raspberry Pi** — systemd unit included:

```bash
sudo cp deploy/tv-remote.service /etc/systemd/system/
# edit User= and WorkingDirectory= to match your setup, and confirm the
# node path with `which node`
sudo systemctl daemon-reload
sudo systemctl enable --now tv-remote
```

**macOS** — launchd agent included:

```bash
cp deploy/com.tvremote.plist ~/Library/LaunchAgents/
# replace YOURNAME, and check `which node` matches the path inside
launchctl load ~/Library/LaunchAgents/com.tvremote.plist
```

**Docker / NAS**:

```bash
docker compose up -d
```

> Host networking is required — the container must send SSDP multicast and
> reach your TV's LAN address, neither of which works on Docker's bridge
> network. That means **Linux only**. On Docker Desktop for Mac or Windows the
> "host" is a hidden Linux VM, not your machine, so discovery silently finds
> nothing. Run it with `npm start` there instead.

A Raspberry Pi Zero 2 W is about the cheapest way to do this properly — plug it
in behind the TV and forget about it.

## Option B — reach it from anywhere (Tailscale)

If what you actually want is "use the remote when I'm not home", the server
still lives at home; you just need a private path back to it.

[Tailscale](https://tailscale.com) is the least painful way. Install it on the
server and on your iPhone, sign both into the same account, and the server gets
a stable address that works from anywhere:

```
http://raspberrypi.tail1234.ts.net:8477
```

Free for personal use, nothing is exposed to the public internet, and no port
forwarding. Add that URL to your home screen instead of the `192.168.x.x` one
and it works on cellular too.

Cloudflare Tunnel does the same job and can give you a real HTTPS hostname, but
it's more setup and puts your remote behind a public URL — put an access policy
on it if you go that way.

## Option C — no always-on machine

Then this project isn't the right tool, and the honest answer is your TV
manufacturer's own app: the Roku app, LG ThinQ, Samsung SmartThings, or the
Vizio SmartCast app. They route through the vendor's cloud, so they need no
server of yours. That's the tradeoff — their servers instead of yours.

## Set a PIN before exposing it anywhere

Whichever remote-access route you take, turn on the shared secret first:

```bash
TV_REMOTE_PIN=428913 npm start
# or, with the installer:
TV_REMOTE_PIN=428913 bash install.sh --service
```

The page prompts once and stores it. Without it, anything that can reach the
port can control your TV.

## Still don't port-forward it

Even with a PIN, forwarding port 8477 through your router puts a TV controller
on the public internet, where scanners will find it within hours. A PIN is a
speed bump, not a front door. Tailscale keeps it off the public internet
entirely, which is a different and much better guarantee.
