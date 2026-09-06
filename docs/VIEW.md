# The Viewfinder

A chosen viewpoint on a running game, repeatable. The desk launches a development run with the
engine's remote console on, you pick a place on the body and a camera and an hour, the desk sends
it to the game, takes the picture, and files it with the frame that produced it. Frames are saved
by name so the same picture can be taken again after a change.

## What the desk needs

`desk.json`:

```jsonc
"view": {
  "program": "${ue_root}/Engine/Binaries/Win64/UnrealEditor-Cmd.exe",
  "args": ["${root}/Basin.uproject", "-game", "-windowed", "-ResX=1600", "-ResY=900", "-nosplash",
           "-EnablePlugins=RemoteControl", "-RCWebControlEnable",
           "-ini:RemoteControl:[/Script/RemoteControlCommon.RemoteControlSettings]:bAllowConsoleCommandRemoteExecution=True,[/Script/RemoteControlCommon.RemoteControlSettings]:bAllowAnyRemoteFunctionCall=True",
           "-log"],
  "port": 30010,                                   // the plugin's HTTP port
  "view_command": "Basin.ViewAt {lat} {lon} {yaw} {pitch} {height} {hour}",
  "shoot_command": "HighResShot {w}x{h}",
  "screenshots": "Saved/Screenshots",              // searched for the newest PNG after a shot
  "frames": "docs/media/frames.json",
  "bake": "Tools/baker/out/Home/1",                // meta.json (face_axes, resolution, overlap_px) + site.json
  "face_map": "T_Home_H_{face}.png",               // the map to click on, per face
  "world": "",                                     // empty: GameDefaultMap from Config/DefaultEngine.ini
  "width": 1600, "height": 900
}
```

The plugin is Epic's **Remote Control API**, enabled from the command line only: nothing in the
`.uproject`, nothing in a shipping config. Its two security switches are passed the same way, so
the allowance exists only in a run the desk started. The server listens on localhost.

## How a picture is taken

1. **Launch** runs the program through the runner (it streams to the Workbench console and is
   recorded like any command). The dot turns green when `GET /remote/info` answers, about a
   minute in.
2. **Go there** sends the view command through `PUT /remote/object/call` on
   `KismetSystemLibrary.ExecuteConsoleCommand`, **with the world as context**. Without a world the
   command reaches only the console manager; with one it reaches the first player's viewport,
   which is where `HighResShot` lives. This was measured: the same call wrote a PNG with the world
   and nothing without it.
3. **Shoot** sends the shoot command, waits for the newest PNG under `screenshots` to appear and
   stop growing, and files it into `docs/media/phase-<n>/` with the frame's name, place, camera and
   hour in the caption and the tags `view` and `frame:<name>`. If the frame is saved, the media id
   is appended to its `shots`.

## Coordinates

Latitude and longitude are in the bake's body frame: `lat = asin(z)`, `lon = atan2(y, x)`, in
degrees, from the unit direction `d = out + u·right + v·up` that `export.face_directions` builds
for each cube face. A click on a face image maps pixel → (u, v) over the extended wedge
`[-limit, limit]`, `limit = 1 + 2·overlap/resolution`, v flipped, then to lat/lon. The game's
`Basin.ViewAt` (a console command; Basin item 3.24) reverses it.

## Over MCP

| tool | what |
|---|---|
| `desk_view_state` | faces, named places from site.json, saved frames, `live` |
| `desk_view_launch` | start the run; returns a run id |
| `desk_view_console` | any console command (`stat fps`, `quit`) |
| `desk_view_go` | move the camera to a frame |
| `desk_view_shoot` | take the picture and file it (default phase: the open one) |
| `desk_view_save_frame` | keep a frame by name |

An agent can therefore take the same named picture before and after a change and file both.
