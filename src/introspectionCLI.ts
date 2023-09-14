import http from "http";
import { inspect } from "util";
import { URL } from "url";

import chalk from "chalk";
import { ArgumentParser } from "argparse";

import { SubscribeStream, desia } from "./utils";

const argParse = new ArgumentParser({
    add_help: true,
    description: "Kasuri introspection command-line client",
});
argParse.add_argument("-s", "--server", {
    metavar: "<host>:<port>",
    default: process.env["KASURI_SERVER"] || "localhost:3018",
    help: "Kasuri introspection server (default: localhost:3018)",
});
argParse.add_argument("-a", "--auth", {
    metavar: "<username>:<password>",
    default: process.env["KASURI_AUTH"],
    help: "Kasuri server basic auth",
});
const subParse = argParse.add_subparsers({ dest: "command" });
subParse.add_parser("status");
subParse.add_parser("dump-all");

const cmdDump = subParse.add_parser("dump");
cmdDump.add_argument("module", { help: "Module name" });
cmdDump.add_argument("state", { help: "State name", nargs: "?" });

const cmdSet = subParse.add_parser("set");
cmdSet.add_argument("module", { help: "Module name" });
cmdSet.add_argument("update", { help: "JS Object notation (e.g. '{ foo: 1 }')" });

const cmdSub = subParse.add_parser("subscribe");
cmdSub.add_argument("module", { help: "Module name" });
cmdSub.add_argument("state", { help: "State name" });

const cmdCall = subParse.add_parser("call");
cmdCall.add_argument("extension", { help: "Extension name" });

function basicAuthHeader(credential) {
    if (!credential) return {};
    const auth = Buffer.from(credential).toString("base64");
    return { Authorization: `Basic ${auth}` };
}

function request(server, auth, path, data = {}) {
    return new Promise((rsov, rjct) => {
        http.request(
            new URL(path, "http://" + server),
            {
                method: "POST",
                headers: basicAuthHeader(auth),
            },
            (res) => {
                const data = [];
                res.on("data", (chunk) => data.push(chunk));
                res.on("end", () => {
                    if (res.statusCode === 200) {
                        rsov(desia.deserialize(Buffer.concat(data)));
                        return;
                    }
                    rjct(Error(`${res.statusCode} ${Buffer.concat(data).toString("utf8")}`));
                });
            }
        ).end(JSON.stringify(data));
    });
}

(async function main() {
    const args = argParse.parse_args();

    if (args.command === "status") {
        const moduleList = (await request(args.server, args.auth, "/status")) as [string, string, string][];
        moduleList.sort((a, b) => a[0].localeCompare(b[0]));
        const maxLen = Math.max(...moduleList.map((m) => m[0].length));
        moduleList.forEach(([module, status, statusMessage]) => {
            const style =
                {
                    pending: (s) => chalk.yellow(s),
                    online: (s) => chalk.greenBright(s),
                    offline: (s) => chalk.gray(s),
                    failure: (s) => chalk.redBright(s),
                }[status] || ((s) => s);
            console.log(`${module.padStart(maxLen)}: ${style(status.padEnd(8)) + statusMessage}`);
        });
    }

    if (args.command === "dump-all") {
        const state = await request(args.server, args.auth, "/dumpState");
        console.log(inspect(state, { depth: null, colors: true }));
    }

    if (args.command === "dump") {
        const state = await request(args.server, args.auth, "/dumpState", {
            module: args.module,
            state: args.state,
        });
        console.log(inspect(state, { depth: null, colors: true }));
    }

    if (args.command === "set") {
        const update = eval("(" + args.update + ")");
        if (typeof update !== "object") {
            console.error("Invalid update param, must be JS object");
            return;
        }
        await request(args.server, args.auth, "/setState", { module: args.module, update });
        console.log("OK");
    }

    if (args.command === "subscribe") {
        http.request(
            new URL("/subscribeState", "http://" + args.server),
            {
                method: "POST",
                headers: basicAuthHeader(args.auth),
            },
            (res) => {
                res.pipe(new SubscribeStream()).on("data", (msg) => {
                    const { curr } = desia.deserialize<any>(msg);
                    console.log(`${curr.updateTime/1000} ${inspect(curr.value, { depth: null, colors: true })}`);
                });
            }
        ).end(JSON.stringify({ module: args.module, state: args.state }));
    }

    if (args.command === "call") {
        const req = http.request(
            new URL(`/call/${args.extension}`, "http://" + args.server),
            { method: "POST", headers: basicAuthHeader(args.auth) },
            (res) => {
                res.pipe(process.stdout);
            }
        );
        if (process.stdin.isTTY) req.end();
        else process.stdin.pipe(req);
    }
})();
