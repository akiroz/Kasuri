import http from "http";
import { Kasuri, ModuleStateMap } from "./kasuri";

interface Config<T extends ModuleStateMap> {
    kasuri: Kasuri<T>;
    port: number;
}

export default async function<T extends ModuleStateMap>(config: Config<T>) {
    const server = http.createServer((req, res) => {
        if (req.method !== "POST") {
            res.writeHead(400).end("Invalid method");
            return;
        }
        const data = [];
        req.setEncoding("utf8");
        req.on("data", chunk => data.push(chunk));
        req.on("end", () => {
            const body = JSON.parse(data.join("") || "{}");
            switch (req.url) {
                case "/dumpState":
                    res.end(JSON.stringify(config.kasuri.store));
                    break;
                case "/subscribeState":
                    if (!(body.module && body.state)) {
                        res.writeHead(400).end("Invalid params");
                        return;
                    }
                    config.kasuri.subscribeState(body.module, body.state, (value, old) => {
                        res.write(JSON.stringify({ value, old }) + "\n");
                    });
                    break;
                case "/setState":
                    if (!(body.module && body.update)) {
                        res.writeHead(400).end("Invalid params");
                        return;
                    }
                    Object.entries(body.update).forEach(([k, v]) => {
                        config.kasuri.setState(body.module, k as any, v);
                    });
                    res.end("OK");
                    break;
                default:
                    res.writeHead(400).end("Invalid path");
            }
        });
    });
    await new Promise(r => server.listen(config.port, r));
    return server;
}