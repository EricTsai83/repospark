/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  insertTestArtifact,
  insertTestArtifactFolder,
  insertTestRepository,
  insertTestThread,
} from "../test/convex/fixtures";
import {
  MAX_ARTIFACT_VERSIONS,
  MAX_PRUNE_DELETES_PER_UPDATE,
  replaceArtifactInFolderWrite,
  updateArtifactWrite,
} from "./lib/artifactWrites";
import { createTestConvex, type SystifyTestConvex } from "../test/convex/harness";
import { withPausedConvexScheduler } from "../test/convex/scheduler";

const OWNER = "user|artifact-store-test";
const OTHER_OWNER = "user|artifact-store-other";

async function seedThread(t: SystifyTestConvex): Promise<Id<"threads">> {
  return await insertTestThread(t, {
    ownerTokenIdentifier: OWNER,
    title: "design conversation",
    mode: "discuss",
  });
}

async function seedRepository(t: SystifyTestConvex): Promise<Id<"repositories">> {
  return await insertTestRepository(t, {
    ownerTokenIdentifier: OWNER,
  });
}

async function seedArtifactFolder(
  t: SystifyTestConvex,
  args: {
    repositoryId: Id<"repositories">;
    ownerTokenIdentifier?: string;
  },
): Promise<Id<"artifactFolders">> {
  return await insertTestArtifactFolder(t, {
    repositoryId: args.repositoryId,
    ownerTokenIdentifier: args.ownerTokenIdentifier ?? OWNER,
  });
}

async function seedArtifact(
  t: SystifyTestConvex,
  args: {
    threadId?: Id<"threads">;
    repositoryId?: Id<"repositories">;
    ownerTokenIdentifier?: string;
    kind?: "architecture_diagram" | "design_review";
    title?: string;
    description?: string;
    contentMarkdown?: string;
    folderId?: Id<"artifactFolders">;
  },
): Promise<Id<"artifacts">> {
  return await insertTestArtifact(t, {
    threadId: args.threadId,
    repositoryId: args.repositoryId,
    ownerTokenIdentifier: args.ownerTokenIdentifier ?? OWNER,
    kind: args.kind,
    title: args.title,
    description: args.description,
    contentMarkdown: args.contentMarkdown,
    folderId: args.folderId,
  });
}

describe("ArtifactStore — parent invariant", () => {
  test("rejects creation when neither threadId nor repositoryId is provided", async () => {
    const t = createTestConvex();

    await expect(
      t.mutation(internal.artifactStore.createArtifact, {
        ownerTokenIdentifier: OWNER,
        kind: "architecture_diagram",
        title: "orphan",
        description: "no parent",
        contentMarkdown: "# x",
      }),
    ).rejects.toThrow(/at least one parent/i);
  });

  test("accepts a thread-only parent and persists with no repositoryId", async () => {
    const t = createTestConvex();
    const threadId = await seedThread(t);

    const artifactId = await t.mutation(internal.artifactStore.createArtifact, {
      threadId,
      ownerTokenIdentifier: OWNER,
      kind: "architecture_diagram",
      title: "Diagram 001",
      description: "pick A over B",
      contentMarkdown: "# Decision",
    });

    const stored = await t.query(internal.artifactStore.getArtifact, { artifactId });
    expect(stored).not.toBeNull();
    expect(stored!.threadId).toBe(threadId);
    expect(stored!.repositoryId).toBeUndefined();
    expect(stored!.kind).toBe("architecture_diagram");
    expect(stored!.version).toBe(1);
  });

  test("accepts a repository-only parent and persists with no threadId", async () => {
    await withPausedConvexScheduler(async () => {
      const t = createTestConvex();
      const repositoryId = await seedRepository(t);

      const artifactId = await t.mutation(internal.artifactStore.createArtifact, {
        repositoryId,
        ownerTokenIdentifier: OWNER,
        kind: "architecture_diagram",
        title: "Modules",
        description: "top-level modules",
        contentMarkdown: "graph TD; A --> B",
      });

      const stored = await t.query(internal.artifactStore.getArtifact, { artifactId });
      expect(stored).not.toBeNull();
      expect(stored!.repositoryId).toBe(repositoryId);
      expect(stored!.threadId).toBeUndefined();
      expect(stored!.kind).toBe("architecture_diagram");
    });
  });

  test("accepts both thread and repository parents simultaneously", async () => {
    await withPausedConvexScheduler(async () => {
      const t = createTestConvex();
      const threadId = await seedThread(t);
      const repositoryId = await seedRepository(t);

      const artifactId = await t.mutation(internal.artifactStore.createArtifact, {
        threadId,
        repositoryId,
        ownerTokenIdentifier: OWNER,
        kind: "design_review",
        title: "risk",
        description: "design review",
        contentMarkdown: "## Risk",
      });

      const stored = await t.query(internal.artifactStore.getArtifact, { artifactId });
      expect(stored!.threadId).toBe(threadId);
      expect(stored!.repositoryId).toBe(repositoryId);
    });
  });
});

describe("ArtifactStore — folder integrity", () => {
  test("accepts a folder in the artifact repository scope", async () => {
    await withPausedConvexScheduler(async () => {
      const t = createTestConvex();
      const repositoryId = await seedRepository(t);
      const folderId = await seedArtifactFolder(t, { repositoryId });

      const artifactId = await t.mutation(internal.artifactStore.createArtifact, {
        repositoryId,
        ownerTokenIdentifier: OWNER,
        kind: "architecture_diagram",
        title: "Diagram 001",
        description: "s",
        contentMarkdown: "m",
        folderId,
      });

      const stored = await t.query(internal.artifactStore.getArtifact, { artifactId });
      expect(stored!.folderId).toBe(folderId);
    });
  });

  test("rejects a missing or deleted folder", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);
    const folderId = await seedArtifactFolder(t, { repositoryId });
    await t.run(async (ctx) => {
      await ctx.db.delete(folderId);
    });

    await expect(
      t.mutation(internal.artifactStore.createArtifact, {
        repositoryId,
        ownerTokenIdentifier: OWNER,
        kind: "architecture_diagram",
        title: "Diagram 001",
        description: "s",
        contentMarkdown: "m",
        folderId,
      }),
    ).rejects.toThrow(/folder not found/i);
  });

  test("rejects a folder from another repository", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);
    const otherRepositoryId = await seedRepository(t);
    const folderId = await seedArtifactFolder(t, { repositoryId: otherRepositoryId });

    await expect(
      t.mutation(internal.artifactStore.createArtifact, {
        repositoryId,
        ownerTokenIdentifier: OWNER,
        kind: "architecture_diagram",
        title: "Diagram 001",
        description: "s",
        contentMarkdown: "m",
        folderId,
      }),
    ).rejects.toThrow(/different repository/i);
  });

  test("rejects a repository folder for a repo-less artifact", async () => {
    const t = createTestConvex();
    const threadId = await seedThread(t);
    const repositoryId = await seedRepository(t);
    const folderId = await seedArtifactFolder(t, { repositoryId });

    await expect(
      t.mutation(internal.artifactStore.createArtifact, {
        threadId,
        ownerTokenIdentifier: OWNER,
        kind: "architecture_diagram",
        title: "Diagram 001",
        description: "s",
        contentMarkdown: "m",
        folderId,
      }),
    ).rejects.toThrow(/repo-less/i);
  });

  test("rejects a folder owned by another user", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);
    const folderId = await seedArtifactFolder(t, {
      repositoryId,
      ownerTokenIdentifier: OTHER_OWNER,
    });

    await expect(
      t.mutation(internal.artifactStore.createArtifact, {
        repositoryId,
        ownerTokenIdentifier: OWNER,
        kind: "architecture_diagram",
        title: "Diagram 001",
        description: "s",
        contentMarkdown: "m",
        folderId,
      }),
    ).rejects.toThrow(/folder not found/i);
  });

  test("moveToFolder accepts a folder in the artifact repository scope", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);
    const folderId = await seedArtifactFolder(t, { repositoryId });
    const artifactId = await seedArtifact(t, { repositoryId });

    const viewer = t.withIdentity({ tokenIdentifier: OWNER });
    await viewer.mutation(api.artifacts.moveToFolder, { artifactId, folderId });

    const stored = await t.query(internal.artifactStore.getArtifact, { artifactId });
    expect(stored!.folderId).toBe(folderId);
  });

  test("moveToFolder rejects a missing or deleted folder", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);
    const folderId = await seedArtifactFolder(t, { repositoryId });
    const artifactId = await seedArtifact(t, { repositoryId });
    await t.run(async (ctx) => {
      await ctx.db.delete(folderId);
    });

    const viewer = t.withIdentity({ tokenIdentifier: OWNER });
    await expect(viewer.mutation(api.artifacts.moveToFolder, { artifactId, folderId })).rejects.toThrow(
      /folder not found/i,
    );
  });

  test("moveToFolder rejects a folder from another repository", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);
    const otherRepositoryId = await seedRepository(t);
    const folderId = await seedArtifactFolder(t, { repositoryId: otherRepositoryId });
    const artifactId = await seedArtifact(t, { repositoryId });

    const viewer = t.withIdentity({ tokenIdentifier: OWNER });
    await expect(viewer.mutation(api.artifacts.moveToFolder, { artifactId, folderId })).rejects.toThrow(
      /different repository/i,
    );
  });

  test("moveToFolder rejects a repository folder for a repo-less artifact", async () => {
    const t = createTestConvex();
    const threadId = await seedThread(t);
    const repositoryId = await seedRepository(t);
    const folderId = await seedArtifactFolder(t, { repositoryId });
    const artifactId = await seedArtifact(t, { threadId });

    const viewer = t.withIdentity({ tokenIdentifier: OWNER });
    await expect(viewer.mutation(api.artifacts.moveToFolder, { artifactId, folderId })).rejects.toThrow(/repo-less/i);
  });

  test("moveToFolder rejects a folder owned by another user", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);
    const folderId = await seedArtifactFolder(t, {
      repositoryId,
      ownerTokenIdentifier: OTHER_OWNER,
    });
    const artifactId = await seedArtifact(t, { repositoryId });

    const viewer = t.withIdentity({ tokenIdentifier: OWNER });
    await expect(viewer.mutation(api.artifacts.moveToFolder, { artifactId, folderId })).rejects.toThrow(
      /folder not found/i,
    );
  });

  test("moveToFolder rejects moves into a full folder", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);
    const folderId = await seedArtifactFolder(t, { repositoryId });
    const artifactId = await seedArtifact(t, { repositoryId });

    await t.run(async (ctx) => {
      for (let index = 0; index < 200; index += 1) {
        await ctx.db.insert("artifacts", {
          repositoryId,
          ownerTokenIdentifier: OWNER,
          kind: "architecture_diagram",
          title: `Seed ${index}`,
          description: "s",
          contentMarkdown: "m",
          version: 1,
          updatedAt: Date.now(),
          folderId,
        });
      }
    });

    const viewer = t.withIdentity({ tokenIdentifier: OWNER });
    await expect(viewer.mutation(api.artifacts.moveToFolder, { artifactId, folderId })).rejects.toThrow(
      /at most 200 artifacts/i,
    );
  });
});

describe("ArtifactStore — filters", () => {
  test("listByThread returns only artifacts attached to the requested thread", async () => {
    const t = createTestConvex();
    const threadA = await seedThread(t);
    const threadB = await seedThread(t);

    await seedArtifact(t, {
      threadId: threadA,
      title: "A1",
    });
    await seedArtifact(t, {
      threadId: threadB,
      title: "B1",
    });

    const aArtifacts = await t.query(internal.artifactStore.listByThread, { threadId: threadA });
    const bArtifacts = await t.query(internal.artifactStore.listByThread, { threadId: threadB });

    expect(aArtifacts.map((artifact) => artifact.title)).toEqual(["A1"]);
    expect(bArtifacts.map((artifact) => artifact.title)).toEqual(["B1"]);
  });

  test("listByThreadAndKind filters by kind within a thread", async () => {
    const t = createTestConvex();
    const threadId = await seedThread(t);

    await seedArtifact(t, {
      threadId,
      title: "Diagram 1",
    });
    await seedArtifact(t, {
      threadId,
      kind: "design_review",
      title: "Review 1",
    });

    const diagrams = await t.query(internal.artifactStore.listByThreadAndKind, {
      threadId,
      kind: "architecture_diagram",
    });
    const reviews = await t.query(internal.artifactStore.listByThreadAndKind, {
      threadId,
      kind: "design_review",
    });

    expect(diagrams.map((artifact) => artifact.title)).toEqual(["Diagram 1"]);
    expect(reviews.map((artifact) => artifact.title)).toEqual(["Review 1"]);
  });

  test("listByRepository returns only artifacts attached to the requested repository", async () => {
    const t = createTestConvex();
    const repoA = await seedRepository(t);
    const repoB = await seedRepository(t);

    await seedArtifact(t, {
      repositoryId: repoA,
      title: "A diagram",
      contentMarkdown: "graph TD; A --> A",
    });
    await seedArtifact(t, {
      repositoryId: repoB,
      title: "B diagram",
      contentMarkdown: "graph TD; B --> B",
    });

    const aArtifacts = await t.query(internal.artifactStore.listByRepository, {
      repositoryId: repoA,
    });
    const bArtifacts = await t.query(internal.artifactStore.listByRepository, {
      repositoryId: repoB,
    });

    expect(aArtifacts.map((artifact) => artifact.title)).toEqual(["A diagram"]);
    expect(bArtifacts.map((artifact) => artifact.title)).toEqual(["B diagram"]);
  });

  test("listByRepositoryAndKind filters by kind within a repository", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);

    await seedArtifact(t, {
      repositoryId,
      title: "diagram",
      contentMarkdown: "graph TD;",
    });
    await seedArtifact(t, {
      repositoryId,
      kind: "design_review",
      title: "risks",
    });

    const diagrams = await t.query(internal.artifactStore.listByRepositoryAndKind, {
      repositoryId,
      kind: "architecture_diagram",
    });
    const reviews = await t.query(internal.artifactStore.listByRepositoryAndKind, {
      repositoryId,
      kind: "design_review",
    });

    expect(diagrams.map((artifact) => artifact.kind)).toEqual(["architecture_diagram"]);
    expect(reviews.map((artifact) => artifact.kind)).toEqual(["design_review"]);
  });

  test("listFailedArtifactsForReindex skips feature-not-included failures", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);
    const retryableId = await seedArtifact(t, {
      repositoryId,
      title: "retryable",
    });
    const entitlementDeniedId = await seedArtifact(t, {
      repositoryId,
      title: "entitlement denied",
    });
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.patch(retryableId, {
        chunkingStatus: "failed",
        chunkingFailureReason: "embedding_failed",
        lastChunkedAt: now - 60_000,
        lastChunkedVersion: 1,
      });
      await ctx.db.patch(entitlementDeniedId, {
        chunkingStatus: "failed",
        chunkingFailureReason: "feature_not_included",
        lastChunkedAt: now - 60_000,
        lastChunkedVersion: 1,
      });
    });

    const result = await t.query(internal.artifactStore.listFailedArtifactsForReindex, {
      cutoff: now,
      limit: 10,
    });

    expect(result.map((artifact) => artifact._id)).toEqual([retryableId]);
  });
});

describe("ArtifactStore — ordering", () => {
  test("listByThread returns artifacts in newest-first order", async () => {
    const t = createTestConvex();
    const threadId = await seedThread(t);

    await seedArtifact(t, {
      threadId,
      title: "first",
    });
    await seedArtifact(t, {
      threadId,
      title: "second",
    });
    await seedArtifact(t, {
      threadId,
      title: "third",
    });

    const result = await t.query(internal.artifactStore.listByThread, { threadId });
    expect(result.map((artifact) => artifact.title)).toEqual(["third", "second", "first"]);
  });

  test("listByRepository returns artifacts in newest-first order", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);

    await seedArtifact(t, {
      repositoryId,
      title: "v1",
    });
    await seedArtifact(t, {
      repositoryId,
      title: "v2",
    });

    const result = await t.query(internal.artifactStore.listByRepository, { repositoryId });
    expect(result.map((artifact) => artifact.title)).toEqual(["v2", "v1"]);
  });
});

describe("ArtifactStore — update/delete", () => {
  test("updateArtifact bumps the version monotonically", async () => {
    const t = createTestConvex();
    const threadId = await seedThread(t);

    const artifactId = await t.mutation(internal.artifactStore.createArtifact, {
      threadId,
      ownerTokenIdentifier: OWNER,
      kind: "architecture_diagram",
      title: "v1",
      description: "s",
      contentMarkdown: "m",
    });

    await t.mutation(internal.artifactStore.updateArtifact, {
      artifactId,
      title: "v2",
    });
    await t.mutation(internal.artifactStore.updateArtifact, {
      artifactId,
      title: "v3",
    });

    const stored = await t.query(internal.artifactStore.getArtifact, { artifactId });
    expect(stored!.title).toBe("v3");
    expect(stored!.version).toBe(3);
    expect(stored!.description).toBe("s");
    expect(stored!.contentMarkdown).toBe("m");
  });

  test("updateArtifact throws when artifact not found", async () => {
    const t = createTestConvex();
    const threadId = await seedThread(t);

    // Allocate a real artifact id, then delete it so the id is well-formed
    // but does not refer to an existing document.
    const nonexistentId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("artifacts", {
        threadId,
        ownerTokenIdentifier: OWNER,
        kind: "architecture_diagram",
        title: "tombstone",
        description: "s",
        contentMarkdown: "m",
        version: 1,
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.mutation(internal.artifactStore.updateArtifact, {
        artifactId: nonexistentId,
        title: "x",
      }),
    ).rejects.toThrow(/Artifact not found/i);
  });

  test("deleteArtifact removes the artifact", async () => {
    const t = createTestConvex();
    const threadId = await seedThread(t);

    const artifactId = await seedArtifact(t, {
      threadId,
      title: "doomed",
    });

    await t.mutation(internal.artifactStore.deleteArtifact, { artifactId });

    const stored = await t.query(internal.artifactStore.getArtifact, { artifactId });
    expect(stored).toBeNull();
  });
});

describe("ArtifactStore — version history pruning", () => {
  test("an update past the retention cap prunes stale rows and keeps the newest 50", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);
    const artifactId = await seedArtifact(t, { repositoryId, title: "v1" });

    // Seed versions 2..60 directly (avoids 59 mutation round-trips), landing
    // the artifact at version 60 before the real update under test.
    await t.run(async (ctx) => {
      for (let version = 2; version <= 60; version += 1) {
        await ctx.db.insert("artifactVersions", {
          artifactId,
          version,
          ownerTokenIdentifier: OWNER,
          repositoryId,
          title: `Version ${version}`,
          description: "d",
          contentMarkdown: `# Version ${version}`,
          renderFormat: "markdown",
          createdAt: version,
        });
      }
      await ctx.db.patch(artifactId, { version: 60 });
    });

    // The real update bumps to version 61, whose threshold (11) prunes
    // versions 1..10.
    const result = await t.run((ctx) => updateArtifactWrite(ctx, { artifactId, title: "v61" }));
    expect(result.updated).toBe(true);

    const state = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(artifactId),
      versions: await ctx.db
        .query("artifactVersions")
        .withIndex("by_artifactId", (q) => q.eq("artifactId", artifactId))
        .collect(),
    }));

    expect(state.versions).toHaveLength(MAX_ARTIFACT_VERSIONS);
    const versionNumbers = state.versions.map((version) => version.version).sort((a, b) => a - b);
    expect(versionNumbers[0]).toBe(61 - MAX_ARTIFACT_VERSIONS + 1);
    expect(versionNumbers[versionNumbers.length - 1]).toBe(61);
    expect(state.artifact?.version).toBe(61);
    expect(state.artifact?.currentVersionId).toBeTruthy();
    const currentVersion = await t.run((ctx) => ctx.db.get(state.artifact!.currentVersionId!));
    expect(currentVersion?.version).toBe(61);
  });

  test("a blob shared between a stale and a retained version survives prune until unreferenced", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);
    const artifactId = await seedArtifact(t, { repositoryId, title: "v1", contentMarkdown: "# v1" });

    const sharedStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["<html>shared</html>"], { type: "text/html" })),
    );

    // Seed versions 2..60. Version 10 (stale after the first update) and
    // version 55 (retained) share one HTML blob; every other version gets
    // its own distinct storage id so the shared blob is unambiguous.
    await t.run(async (ctx) => {
      for (let version = 2; version <= 60; version += 1) {
        const isSharer = version === 10 || version === 55;
        const htmlStorageId = isSharer
          ? sharedStorageId
          : await ctx.storage.store(new Blob([`<html>${version}</html>`], { type: "text/html" }));
        await ctx.db.insert("artifactVersions", {
          artifactId,
          version,
          ownerTokenIdentifier: OWNER,
          repositoryId,
          title: `Version ${version}`,
          description: "d",
          contentMarkdown: `# Version ${version}`,
          renderFormat: "html",
          htmlStorageId,
          htmlHash: `hash-${version}`,
          htmlByteLength: 10,
          htmlValidationStatus: "valid",
          createdAt: version,
        });
      }
      await ctx.db.patch(artifactId, { version: 60, renderFormat: "html" });
    });

    // Update to version 61 with a distinct new blob (so the shared blob
    // isn't re-adopted by every future version via html-field carry-forward):
    // threshold 11 prunes versions 1..10, including the stale sharer at
    // version 10. Version 55 (retained) still references the shared blob,
    // so it must survive.
    const version61StorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["<html>61</html>"], { type: "text/html" })),
    );
    await t.run((ctx) =>
      updateArtifactWrite(ctx, { artifactId, title: "v61", htmlStorageId: version61StorageId, htmlHash: "hash-61" }),
    );

    const afterFirstPrune = await t.run(async (ctx) => ({
      version10: await ctx.db
        .query("artifactVersions")
        .withIndex("by_artifactId_and_version", (q) => q.eq("artifactId", artifactId).eq("version", 10))
        .unique(),
      blob: await ctx.db.system.get(sharedStorageId),
    }));
    expect(afterFirstPrune.version10).toBeNull();
    expect(afterFirstPrune.blob).not.toBeNull();

    // Drive further updates until version 55 itself falls below the
    // retention threshold and is pruned; only then must the blob go.
    let currentVersion = 61;
    while (currentVersion - MAX_ARTIFACT_VERSIONS < 55) {
      currentVersion += 1;
      await t.run((ctx) => updateArtifactWrite(ctx, { artifactId, title: `v${currentVersion}` }));
    }

    const afterFinalPrune = await t.run(async (ctx) => ({
      version55: await ctx.db
        .query("artifactVersions")
        .withIndex("by_artifactId_and_version", (q) => q.eq("artifactId", artifactId).eq("version", 55))
        .unique(),
      blob: await ctx.db.system.get(sharedStorageId),
    }));
    expect(afterFinalPrune.version55).toBeNull();
    expect(afterFinalPrune.blob).toBeNull();
  });

  // Heavy by design: seeds a backlog well beyond MAX_PRUNE_DELETES_PER_UPDATE
  // stale rows to exercise the per-call deletion bound across two updates.
  test("a large legacy backlog drains across multiple updates instead of one pass", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);
    const artifactId = await seedArtifact(t, { repositoryId, title: "v1" });

    // Backlog large enough that stale-row count alone exceeds the per-call
    // bound: MAX_PRUNE_DELETES_PER_UPDATE stale rows below the threshold,
    // plus the retained window, plus headroom above. `seedArtifact` (via
    // `insertTestArtifact`) only writes the `artifacts` row, not a matching
    // version-1 row in `artifactVersions`, so rows 2..latestSeededVersion
    // are seeded directly here to stand in for the full history.
    const backlogSize = MAX_PRUNE_DELETES_PER_UPDATE + 50;
    const latestSeededVersion = backlogSize + MAX_ARTIFACT_VERSIONS;
    await t.run(async (ctx) => {
      for (let version = 2; version <= latestSeededVersion; version += 1) {
        await ctx.db.insert("artifactVersions", {
          artifactId,
          version,
          ownerTokenIdentifier: OWNER,
          repositoryId,
          title: `Version ${version}`,
          description: "d",
          contentMarkdown: `# Version ${version}`,
          renderFormat: "markdown",
          createdAt: version,
        });
      }
      await ctx.db.patch(artifactId, { version: latestSeededVersion });
    });

    const seededRowCount = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("artifactVersions")
            .withIndex("by_artifactId", (q) => q.eq("artifactId", artifactId))
            .collect()
        ).length,
    );

    await t.run((ctx) => updateArtifactWrite(ctx, { artifactId, title: "next" }));

    const afterFirstUpdate = await t.run(
      async (ctx) =>
        await ctx.db
          .query("artifactVersions")
          .withIndex("by_artifactId", (q) => q.eq("artifactId", artifactId))
          .collect(),
    );
    // The update inserts one new version row, then a single prune call
    // drains stale rows up to the per-call bound. Each row reserves budget
    // for a (blob-delete + row-delete) pair even when it turns out not to
    // need a blob delete, so the bound never splits a pair across calls;
    // for these blob-less markdown rows that means one unit of slack per
    // call, leaving `MAX_PRUNE_DELETES_PER_UPDATE - 1` rows deleted.
    const totalBeforePrune = seededRowCount + 1;
    expect(afterFirstUpdate.length).toBe(totalBeforePrune - (MAX_PRUNE_DELETES_PER_UPDATE - 1));
    // Backlog remains above the retention window, so the drain isn't done yet.
    expect(afterFirstUpdate.length).toBeGreaterThan(MAX_ARTIFACT_VERSIONS);

    // A second update continues draining the remaining backlog.
    await t.run((ctx) => updateArtifactWrite(ctx, { artifactId, title: "next-2" }));
    const afterSecondUpdate = await t.run(
      async (ctx) =>
        await ctx.db
          .query("artifactVersions")
          .withIndex("by_artifactId", (q) => q.eq("artifactId", artifactId))
          .collect(),
    );
    expect(afterSecondUpdate.length).toBeLessThan(afterFirstUpdate.length);
  }, 30_000);

  // Heavy by design: seeds a backlog sized so the per-call deletion bound
  // lands exactly between two stale rows that share one HTML blob, forcing
  // the shared-blob pair to straddle the call boundary deterministically.
  test("a shared blob straddling the per-call bound survives two updates without throwing", async () => {
    const t = createTestConvex();
    const repositoryId = await seedRepository(t);
    const artifactId = await seedArtifact(t, { repositoryId, title: "v1", contentMarkdown: "# v1" });

    const sharedStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["<html>shared</html>"], { type: "text/html" })),
    );

    // Seed MAX_PRUNE_DELETES_PER_UPDATE simple (blob-less) stale rows first,
    // then two stale rows at the END of the stale range that share one HTML
    // blob. Each row the prune loop visits reserves budget for a full
    // (blob-delete + row-delete) pair before starting it (even a blob-less
    // row reserves 2), so the first call's budget is exhausted by the
    // simple rows alone, one row short of the full page: it lands right
    // before touching either shared-blob row, leaving them intact together
    // for the second call to process as one unit.
    const simpleStaleCount = MAX_PRUNE_DELETES_PER_UPDATE;
    const sharedVersionA = simpleStaleCount + 1;
    const sharedVersionB = simpleStaleCount + 2;
    const latestSeededVersion = sharedVersionB + MAX_ARTIFACT_VERSIONS;
    await t.run(async (ctx) => {
      for (let version = 2; version <= latestSeededVersion; version += 1) {
        const isSharer = version === sharedVersionA || version === sharedVersionB;
        if (isSharer) {
          await ctx.db.insert("artifactVersions", {
            artifactId,
            version,
            ownerTokenIdentifier: OWNER,
            repositoryId,
            title: `Version ${version}`,
            description: "d",
            contentMarkdown: `# Version ${version}`,
            renderFormat: "html",
            htmlStorageId: sharedStorageId,
            htmlHash: "hash-shared",
            htmlByteLength: 10,
            htmlValidationStatus: "valid",
            createdAt: version,
          });
        } else {
          await ctx.db.insert("artifactVersions", {
            artifactId,
            version,
            ownerTokenIdentifier: OWNER,
            repositoryId,
            title: `Version ${version}`,
            description: "d",
            contentMarkdown: `# Version ${version}`,
            renderFormat: "markdown",
            createdAt: version,
          });
        }
      }
      await ctx.db.patch(artifactId, { version: latestSeededVersion });
    });

    // First real update: threshold = (latestSeededVersion + 1) -
    // MAX_ARTIFACT_VERSIONS = sharedVersionB + 1, so both sharer rows
    // (sharedVersionA, sharedVersionB) are stale and within the backlog.
    await t.run((ctx) => updateArtifactWrite(ctx, { artifactId, title: "next" }));

    // Second real update must not throw even though the first call may have
    // left the shared-blob pair (or part of the backlog before it) for this
    // call to finish.
    await expect(t.run((ctx) => updateArtifactWrite(ctx, { artifactId, title: "next-2" }))).resolves.not.toThrow();

    // Keep draining until the entire seeded backlog (including the shared
    // pair) is gone, driving further real updates as needed.
    for (let i = 0; i < 5; i += 1) {
      const remainingStale = await t.run(
        async (ctx) =>
          (
            await ctx.db
              .query("artifactVersions")
              .withIndex("by_artifactId_and_version", (q) =>
                q.eq("artifactId", artifactId).lte("version", sharedVersionB),
              )
              .collect()
          ).length,
      );
      if (remainingStale === 0) {
        break;
      }
      await t.run((ctx) => updateArtifactWrite(ctx, { artifactId, title: `drain-${i}` }));
    }

    const finalState = await t.run(async (ctx) => ({
      staleRows: await ctx.db
        .query("artifactVersions")
        .withIndex("by_artifactId_and_version", (q) => q.eq("artifactId", artifactId).lte("version", sharedVersionB))
        .collect(),
      blob: await ctx.db.system.get(sharedStorageId),
    }));
    expect(finalState.staleRows).toHaveLength(0);
    expect(finalState.blob).toBeNull();
  }, 30_000);
});

describe("ArtifactWrites — generated replacement", () => {
  test("replaces stale folder artifact and applies write side effects together", async () => {
    await withPausedConvexScheduler(async () => {
      const t = createTestConvex();
      const repositoryId = await seedRepository(t);
      const folderId = await seedArtifactFolder(t, { repositoryId });
      const staleArtifactId = await seedArtifact(t, {
        repositoryId,
        folderId,
        kind: "architecture_diagram",
        title: "Old architecture",
        contentMarkdown: "# Old",
      });

      await t.run(async (ctx) => {
        await ctx.db.insert("artifactChunks", {
          ownerTokenIdentifier: OWNER,
          repositoryId,
          artifactId: staleArtifactId,
          artifactVersion: 1,
          chunkIndex: 0,
          headingPath: ["Old"],
          startOffset: 0,
          endOffset: 5,
          content: "# Old",
        });
        await ctx.db.insert("artifactViews", {
          ownerTokenIdentifier: OWNER,
          repositoryId,
          artifactId: staleArtifactId,
          viewedAt: Date.now(),
        });
      });

      const artifactId = await t.run(
        async (ctx) =>
          await replaceArtifactInFolderWrite(ctx, {
            repositoryId,
            folderId,
            ownerTokenIdentifier: OWNER,
            kind: "architecture_diagram",
            title: "New architecture",
            description: "New description",
            contentMarkdown: "# New",
            alignedImportCommitSha: "commit-1",
            generatedByProvider: "openai",
            generatedByModel: "gpt-5.5",
            promptVersion: 7,
          }),
      );

      const state = await t.run(async (ctx) => ({
        staleArtifact: await ctx.db.get(staleArtifactId),
        replacement: await ctx.db.get(artifactId),
        staleChunks: await ctx.db
          .query("artifactChunks")
          .withIndex("by_artifactId_and_chunkIndex", (q) => q.eq("artifactId", staleArtifactId))
          .collect(),
        staleViews: await ctx.db
          .query("artifactViews")
          .withIndex("by_artifactId", (q) => q.eq("artifactId", staleArtifactId))
          .collect(),
      }));

      expect(state.staleArtifact).toBeNull();
      expect(state.staleChunks).toEqual([]);
      expect(state.staleViews).toEqual([]);
      expect(state.replacement).toMatchObject({
        repositoryId,
        folderId,
        ownerTokenIdentifier: OWNER,
        kind: "architecture_diagram",
        title: "New architecture",
        version: 1,
        chunkingStatus: "pending",
        alignedImportCommitSha: "commit-1",
        generatedByProvider: "openai",
        generatedByModel: "gpt-5.5",
        promptVersion: 7,
      });
      expect(state.replacement?.lastVerifiedAt).toEqual(expect.any(Number));
      expect(state.replacement?.updatedAt).toEqual(expect.any(Number));
    });
  });
});
