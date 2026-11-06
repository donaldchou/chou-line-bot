import mongoose from "mongoose";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

// dev 模式會 hot reload，用 global 快取連線避免重複建立
const g = globalThis as typeof globalThis & { _mongooseCache?: MongooseCache };
const cache: MongooseCache = g._mongooseCache ?? { conn: null, promise: null };
g._mongooseCache = cache;

/** 取得共用的 MongoDB 連線 */
export async function connectDB() {
  if (cache.conn) return cache.conn;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("請在 .env.local 設定 MONGODB_URI");
  if (!cache.promise) cache.promise = mongoose.connect(uri, { bufferCommands: false });
  try {
    cache.conn = await cache.promise;
  } catch (err) {
    cache.promise = null;
    throw err;
  }
  return cache.conn;
}
