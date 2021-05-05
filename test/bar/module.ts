import { Module } from "../../src/kasuri";
import State from "../state";

export default class extends Module<typeof State["bar"], typeof State> {
    async init() {
        this.setState({ status: "online" });
        this.handleTask("foo", "additionReq", "additionTask", async ([a, b]) => a + b);
        this.handleTask("foo", "defaultPendingReq", "defaultPendingTask", async (data, id) => {
            return new Promise<number>(r => {
                setTimeout(() => {
                    this.swapState("defaultPendingTask", ({ value: taskState }) => {
                        taskState.task[id].status = "active";
                        return taskState;
                    });
                }, 2000);
                setTimeout(() => { r(data) }, 1000)
            })
        });
    }
}
