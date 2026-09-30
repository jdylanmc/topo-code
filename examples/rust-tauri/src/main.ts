import { invoke } from "@tauri-apps/api/core";

const SNAPSHOT_COMMAND = "snapshot";
export async function refresh(ready: boolean) {
  return invoke<string>(SNAPSHOT_COMMAND, { ready });
}
