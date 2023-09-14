import http from "http";
import { inspect } from "util";
import { URL } from "url";

import chalk from "chalk";
import { ArgumentParser } from "argparse";

import { SubscribeStream, desia } from "./utils";

const argParse = new ArgumentParser({
    addHelp: true,
    description: "Kasuri introspection command-line client",
});
argParse.addArgument(["-s", "--server"], {
    metavar: "<host>:<port>",
    defaultValue: process.env["KASURI_SERVER"] || "localhost:3018",
    help: "Kasuri introspection server (default: localhost:3018)",
});
argParse.addArgument(["-a", "--auth"], {
    metavar: "<username>:<password>",
    defaultValue: process.env["KASURI_AUTH"],
    help: "Kasuri server basic auth",
});
const subParse = argParse.addSubparsers({ dest: "command" });
subParse.addParser("status");
subParse.addParser("dump-all");
const cmdDump = subParse.addParser("dump");
cmdDump.addArgument("module", { help: "Module name" });
cmdDump.addArgument("state", { help: "State name", required: false });
const cmdSet = subParse.addParser("set");
cmdSet.addArgument("module", { help: "Module name" });
cmdSet.addArgument("update", { help: "JS Object notation (e.g. '{ foo: 1 }')" });
const cmdSub = subParse.addParser("subscribe");
cmdSub.addArgument("module", { help: "Module name" });
cmdSub.addArgument("state", { help: "State name" });
const cmdCall = subParse.addParser("call");
cmdCall.addArgument("extension", { help: "Extension name" });

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
    const args = argParse.parseArgs();

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
