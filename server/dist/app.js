"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const routes_1 = require("./routes");
const error_middleware_1 = require("./middlewares/error.middleware");
function createApp(_env) {
    const app = (0, express_1.default)();
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)());
    app.use(express_1.default.json({ limit: '2mb' }));
    app.use(express_1.default.urlencoded({ extended: true }));
    // 必须在业务 Router 之前注册。Cloud Run 保留「以 z 结尾」的路径，/healthz 无法到达容器（见官方 known-issues）。
    app.get('/health', (_req, res) => res.status(200).json({ success: true, data: 'ok' }));
    app.use((0, routes_1.createRouter)(_env));
    app.use(error_middleware_1.errorMiddleware);
    return app;
}
