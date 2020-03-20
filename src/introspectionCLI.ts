import http from "http";
import { inspect } from "util";
import { URL } from "url";
import { ArgumentParser } from "argparse";
import split2 from "split2";
import chalk from "chalk";

const argParse = new ArgumentParser({
    addHelp: true,
    description: "Kasuri introspection command-line client",
});
argParse.addArgument(["-s", "--server"], {
    metavar: "<host>:<port>",
    defaultValue: "localhost:3018",
    help: "Kasuri introspection server (default: localhost:3018)",
});
const subParse = argParse.addSubparsers({ dest: "command" });
subParse.addParser("status");
subParse.addParser("dump");
const cmdSet = subParse.addParser("set");
cmdSet.addArgument("module", { help: "Module name" });
cmdSet.addArgument("update", { help: "JS Object notation (e.g. '{ foo: 1 }')" });
const cmdSub = subParse.addParser("subscribe");
cmdSub.addArgument("module", { help: "Module name" });
cmdSub.addArgument("state", { help: "State name" });

function request(server, path, data = {}) {
    return new Promise(rsov => {
        http.request(new URL(path, "http://" + server), { method: "POST" }, res => {
            const data = [];
            res.setEncoding("utf8");
            res.on("data", chunk => data.push(chunk));
            res.on("end", () => {
                rsov(JSON.parse(data.join("")));
            });
        }).end(JSON.stringify(data));
    });
}

(async function main() {
    const args = argParse.parseArgs();

    if (args.command === "status") {
        const state = await request(args.server, "/dumpState");
        const moduleList = Object.keys(state).sort();
        const maxLen = Math.max(...moduleList.map(m => m.length));
        moduleList.forEach(module => {
            const {
                status: { value: status },
                statusMessage: { value: statusMessage },
            } = state[module] as {
                status: { value: string };
                statusMessage: { value: string };
            };
            const style =
                {
                    pending: s => chalk.yellow(s),
                    online: s => chalk.greenBright(s),
                    offline: s => chalk.gray(s),
                    failure: s => chalk.redBright(s),
                }[status] || (s => s);
            console.log(`${module.padStart(maxLen)}: ${style(status.padEnd(8)) + statusMessage}`);
        });
    }

    if (args.command === "dump") {
        const state = await request(args.server, "/dumpState");
        console.log(inspect(state, { depth: null, colors: true }));
    }

    if (args.command === "set") {
        const update = eval("(" + args.update + ")");
        if (typeof update !== "object") {
            console.error("Invalid update param, must be JS object");
            return;
        }
        await request(args.server, "/setState", { module: args.module, update });
        console.log("OK");
    }

    if (args.command === "subscribe") {
        http.request(new URL("/subscribeState", "http://" + args.server), { method: "POST" }, res => {
            res.setEncoding("utf8");
            res.pipe(split2()).on("data", msg => {
                console.log(msg);
            });
        }).end(JSON.stringify({ module: args.module, state: args.state }));
    }
})();
