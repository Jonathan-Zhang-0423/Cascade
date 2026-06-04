import express from "express";
import { toCloudflareHandler } from "@cloudflare/itty-router-adapter";
// 同目录下原有入口 index.ts
import app from "./infra/index.js";

export default toCloudflareHandler(app);
