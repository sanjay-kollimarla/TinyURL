import { type Collection, MongoServerError } from "mongodb";
import type { InsertResult, LinkRepository } from "../../application/ports";
import type { Link } from "../../domain/link";
import type { LinkDocument } from "./mongo";

const DUPLICATE_KEY = 11000;

export class MongoLinkRepository implements LinkRepository {
  constructor(private readonly links: Collection<LinkDocument>) {}

  async insert(link: Link): Promise<InsertResult> {
    try {
      await this.links.insertOne(toDocument(link));
      return { status: "inserted" };
    } catch (err) {
      if (err instanceof MongoServerError && err.code === DUPLICATE_KEY) {
        return { status: err.keyPattern && "dedupKey" in err.keyPattern ? "duplicate-url" : "duplicate-code" };
      }
      throw err;
    }
  }

  async findByCode(code: string): Promise<Link | null> {
    const doc = await this.links.findOne({ _id: code });
    return doc && toLink(doc);
  }

  async findPermanentByUrlHash(urlHash: string): Promise<Link | null> {
    const doc = await this.links.findOne({ dedupKey: urlHash });
    return doc && toLink(doc);
  }

  async deleteByCode(code: string): Promise<boolean> {
    const result = await this.links.deleteOne({ _id: code });
    return result.deletedCount === 1;
  }
}

function toDocument(link: Link): LinkDocument {
  const isDedupable = !link.custom && link.expiresAt === null;
  return {
    _id: link.code,
    longUrl: link.longUrl,
    urlHash: link.urlHash,
    custom: link.custom,
    ...(isDedupable && { dedupKey: link.urlHash }),
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    clickCount: link.clickCount,
    lastClickedAt: link.lastClickedAt,
  };
}

function toLink(doc: LinkDocument): Link {
  return {
    code: doc._id,
    longUrl: doc.longUrl,
    urlHash: doc.urlHash,
    custom: doc.custom,
    createdAt: doc.createdAt,
    expiresAt: doc.expiresAt,
    clickCount: doc.clickCount,
    lastClickedAt: doc.lastClickedAt,
  };
}
