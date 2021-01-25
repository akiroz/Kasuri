import http from "http";
import { Kasuri, ModuleStateMap } from "./kasuri";
import { AddressInfo } from "net";

interface Config<T extends ModuleStateMap> {
    kasuri: Kasuri<T>;
    port?: number;
    jsonReplacer?: (key, value) => any;
    extension?: { [name: string]: (kasuri: Kasuri<T>, req: Buffer) => Promise<Buffer> };
    basicAuth?: string;
}

function isLocal(req: http.IncomingMessage): boolean {
    const { family, address } = req.socket.address() as AddressInfo;
    return (family === "IPv4" && address === "127.0.0.1") || (family === "IPv6" && address === "::ffff:127.0.0.1");
}

export async function server<T extends ModuleStateMap>(config: Config<T>) {
    const server = http.createServer((req, res) => {
        if (config.basicAuth && !isLocal(req)) {
            const auth = Buffer.from(config.basicAuth).toString("base64");
            if (req.headers.authorization !== `Basic ${auth}`) {
                if (res.writable) res.writeHead(401, { "WWW-Authenticate": "Basic" }).end("Unauthorized");
                return;
            }
        }

        if (req.method === "OPTIONS") {
            res.writeHead(204, {
                Connection: "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST",
                "Access-Control-Max-Age": "86400",
            }).end();
            return;
        }

        if (req.method !== "POST") {
            res.writeHead(400).end("Invalid method");
            return;
        }

        const data = [];
        req.on("data", (chunk) => data.push(chunk));
        req.on("end", async () => {
            if (req.url.startsWith("/call")) {
                const body = Buffer.concat(data);
                const [url, extension] = req.url.match(/^\/call\/(.+)$/);
                if (config.extension && config.extension[extension]) {
                    res.end(await config.extension[extension](config.kasuri, body));
                } else {
                    res.writeHead(400).end("Invalid extension\n");
                }
            } else {
                const json = Buffer.concat(data).toString("utf8");
                const body = JSON.parse(json || "{}");
                switch (req.url) {
                    case "/status":
                        res.writeHead(200, {
                            "Access-Control-Allow-Origin": "*",
                        }).end(
                            JSON.stringify(
                                Object.keys(config.kasuri.store).map((module) => {
                                    const { status, statusMessage } = config.kasuri.store[module];
                                    return [module, status.value, statusMessage.value];
                                })
                            )
                        );
                        break;
                    case "/dumpState":
                        res.writeHead(200, {
                            "Access-Control-Allow-Origin": "*",
                        }).end(
                            JSON.stringify(
                                body.module ? config.kasuri.store[body.module] : config.kasuri.store,
                                config.jsonReplacer
                            )
                        );
                        break;
                    case "/subscribeState":
                        if (!(body.module && body.state)) {
                            res.writeHead(400).end("Invalid params");
                            return;
                        }
                        config.kasuri.subscribeState(body.module, body.state, (curr, prev) => {
                            res.write(JSON.stringify({ curr, prev }, config.jsonReplacer) + "\n");
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
                        res.end(JSON.stringify({ result: "ok" }));
                        break;
                    default:
                        res.writeHead(400).end("Invalid path");
                }
            }
        });
    });
    await new Promise<void>((r) => server.listen(config.port || process.env["KASURI_SERVER_PORT"] || 3018, r));
    return server;
}
