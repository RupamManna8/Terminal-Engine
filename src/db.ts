import { MongoClient, ObjectId } from 'mongodb';
import dns from 'dns';
import { config } from './config';

let client: MongoClient | null = null;
let database: ReturnType<MongoClient['db']> | null = null;

function mapSelect(select: any) {
	if (!select) return undefined;
	const proj: any = {};
	for (const k of Object.keys(select)) {
		proj[k] = select[k] ? 1 : 0;
	}
	return proj;
}

function mapWhere(where: any) {
	if (!where) return {};
	const q: any = {};
	for (const k of Object.keys(where)) {
		const v = where[k];
		if (k === 'id') {
			try {
				q._id = new ObjectId(v);
			} catch {
				q._id = v;
			}
		} else {
			q[k] = v;
		}
	}
	return q;
}

function wrap(collectionName: string) {
	return {
		findUnique: async ({ where, select }: { where: any; select?: any }) => {
			const coll = database!.collection(collectionName);
			const doc = await coll.findOne(mapWhere(where), { projection: mapSelect(select) });
			if (!doc) return null;
			// expose id as string
			if (doc._id) doc.id = doc._id.toString();
			return doc;
		},
		create: async ({ data }: { data: any }) => {
			const coll = database!.collection(collectionName);
			const now = new Date();
			const toInsert = { ...data, createdAt: now, updatedAt: now };
			const res = await coll.insertOne(toInsert as any);
			const doc = await coll.findOne({ _id: res.insertedId });
			if (doc && doc._id) doc.id = doc._id.toString();
			return doc;
		},
		update: async ({ where, data }: { where: any; data: any }) => {
			const coll = database!.collection(collectionName);
			const res = await coll.findOneAndUpdate(mapWhere(where), { $set: { ...data, updatedAt: new Date() } }, { returnDocument: 'after' as any });
			const doc = res.value as any;
			if (!doc) return null;
			if (doc._id) doc.id = doc._id.toString();
			return doc;
		},
		upsert: async ({ where, create, update }: { where: any; create: any; update: any }) => {
			const coll = database!.collection(collectionName);
			const res = await coll.findOneAndUpdate(mapWhere(where), { $set: { ...update, updatedAt: new Date() }, $setOnInsert: { ...create, createdAt: new Date() } }, { upsert: true, returnDocument: 'after' as any });
			const doc = res.value as any;
			if (doc && doc._id) doc.id = doc._id.toString();
			return doc;
		},
		deleteMany: async ({ where }: { where: any }) => {
			const coll = database!.collection(collectionName);
			const res = await coll.deleteMany(mapWhere(where));
			return { count: res.deletedCount } as any;
		},
	};
}

export const prisma = {
	user: null as any,
	terminalState: null as any,
	progress: null as any,
	githubCredential: null as any,

	$connect: async () => {
		// Allow overriding DNS resolver via env, default to 8.8.8.8
		try {
			const dnsServer = process.env.DNS_SERVER || '8.8.8.8';
			dns.setServers([dnsServer]);
		} catch (e) {
			// non-fatal if setting DNS servers fails
		}

		const maxAttempts = 5;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				if (!client) {
					client = new MongoClient(config.DATABASE_URL);
					await client.connect();
					database = client.db();
					prisma.user = wrap('users');
					prisma.terminalState = wrap('terminalStates');
					prisma.progress = wrap('progress');
					prisma.githubCredential = wrap('githubCredentials');
				}
				return;
			} catch (err: any) {
				const isLast = attempt === maxAttempts;
				// If DNS SRV lookup refused (common transient), retry with backoff
				if (isLast) throw err;
				const wait = Math.min(1000 * attempt, 5000);
				// log to console for debugging in absence of logger at this layer
				// eslint-disable-next-line no-console
				console.warn(`MongoDB connect attempt ${attempt} failed (${err?.code || err?.message}). retrying in ${wait}ms`);
				await new Promise((res) => setTimeout(res, wait));
			}
		}
	},

	$disconnect: async () => {
		if (client) {
			await client.close();
			client = null;
			database = null;
		}
	},

	$transaction: async (arr: Promise<any>[]) => {
		return Promise.all(arr);
	},
};
