import { Transform } from "stream";
import { DeSia, constructors as builtinConstructors } from "sializer";

class None {}
export const desia = new DeSia({
    constructors: [
        ...builtinConstructors,
        {
            constructor: None,
            code: 0,
            args: (x) => x,
            build: (x) => x,
        }
    ]
});

export class SubscribeStream extends Transform {
    len = -1;
    buffered = 0;
    chunks = [];

    _transform(chunk, enc, cb) {
        this.chunks.push(chunk);
        this.buffered += chunk.length;
        while(true) {
            while(this.len < 0 && this.buffered >= 4) {
                const neoChunk = Buffer.concat(this.chunks);
                this.chunks = [neoChunk.slice(4)];
                this.buffered = neoChunk.length - 4;
                this.len = neoChunk.readUInt32LE(0);
                if(this.len == 0) this.len = -1;
            }
            if(this.len >= 0 && this.buffered >= this.len) {
                const neoChunk = Buffer.concat(this.chunks);
                this.chunks = [neoChunk.slice(this.len)];
                this.buffered = neoChunk.length - this.len;
                this.push(neoChunk.slice(0, this.len));
                this.len = -1;
            } else {
                break;
            }
        }
        cb();
    }
}