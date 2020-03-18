import http from "http";
import { inspect } from "util";
import { URL } from "url";
import { ArgumentParser } from "argparse";
import split2 from "split2";

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
subParse.addParser("dump");
const cmdSet = subParse.addParser("set");
cmdSet.addArgument(["-m", "--module"], { required: true });
cmdSet.addArgument(["-u", "--update"], { required: true, metavar: "'{ foo: 1 }'" });
const cmdSub = subParse.addParser("subscribe");
cmdSub.addArgument(["-m", "--module"], { required: true });
cmdSub.addArgument(["-k", "--state"], { required: true });

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
