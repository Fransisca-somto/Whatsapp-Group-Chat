// Wires Baileys events to group tracking and message storage (api-interfaces.md §4.1).
// attach() is called for every new socket; syncOnOpen() each time the connection opens.
import { jidNormalizedUser } from "baileys";

import type { AuditStore } from "../db/auditRepo.ts";
import type { GroupStore } from "../db/groupsRepo.ts";
import type { MessageStore } from "../db/messagesRepo.ts";
import type { Logger } from "../logger.ts";
import type { SocketLike } from "../whatsapp/connection.ts";
import { isBotUser, type BotIdentity } from "./detectTag.ts";
import { createGroupDirectory } from "./groupDirectory.ts";
import { syncGroups } from "./groupSync.ts";
import { createInboundHandler, type TaggedHandler } from "./handleInbound.ts";

export type Ingest = {
  attach(sock: SocketLike): void;
  syncOnOpen(sock: SocketLike): Promise<void>;
};

export function botIdentity(sock: SocketLike): BotIdentity {
  const user = sock.user;
  return {
    jid: user?.id ? jidNormalizedUser(user.id) : null,
    lid: user?.lid ? jidNormalizedUser(user.lid) : null,
  };
}

/** Participants arrive as objects in Baileys v7 (strings in older versions). */
function participantIds(participant: unknown): string[] {
  if (typeof participant === "string") return [participant];
  if (participant && typeof participant === "object") {
    const p = participant as { id?: string; lid?: string; phoneNumber?: string };
    return [p.id, p.lid, p.phoneNumber].filter((id): id is string => Boolean(id));
  }
  return [];
}

export function createIngest(deps: {
  groups: GroupStore;
  messages: MessageStore;
  audit: AuditStore;
  logger: Logger;
  onTagged: TaggedHandler;
}): Ingest {
  const log = deps.logger.child({ module: "ingest" });
  const directory = createGroupDirectory({
    store: deps.groups,
    audit: deps.audit,
    logger: deps.logger,
  });

  const safely = (what: string, task: () => Promise<void>) => {
    void task().catch((error: unknown) => log.error({ err: error }, `${what} failed`));
  };

  async function presentFromWhatsApp(sock: SocketLike, jid: string) {
    const meta = await sock.groupMetadata(jid);
    return directory.present(jid, meta.subject);
  }

  return {
    attach(sock) {
      const inbound = createInboundHandler({
        directory,
        messages: deps.messages,
        groups: deps.groups,
        lookupPhone: (lid) => sock.signalRepository.lidMapping.getPNForLID(lid),
        getBot: () => botIdentity(sock),
        onUnknownGroup: (jid) =>
          presentFromWhatsApp(sock, jid).catch((error: unknown) => {
            log.warn({ err: error, jid }, "could not look up unknown group");
            return null;
          }),
        onTagged: deps.onTagged,
        logger: deps.logger,
      });

      sock.ev.on("messages.upsert", ({ messages, type }) => {
        if (type !== "notify") return; // history and appends are not new conversation
        safely("message ingest", async () => {
          for (const message of messages) await inbound.handle(message);
        });
      });

      sock.ev.on("groups.upsert", (groups) => {
        safely("group upsert", async () => {
          for (const group of groups) await directory.present(group.id, group.subject);
        });
      });

      sock.ev.on("groups.update", (updates) => {
        safely("group update", async () => {
          for (const update of updates) {
            if (update.id && update.subject) await directory.renamed(update.id, update.subject);
          }
        });
      });

      sock.ev.on("group-participants.update", ({ id, participants, action }) => {
        const bot = botIdentity(sock);
        const involvesBot = (participants as unknown[]).some((p) =>
          participantIds(p).some((pid) => isBotUser(pid, bot)),
        );
        if (!involvesBot) return;
        safely("group membership change", async () => {
          if (action === "remove") await directory.gone(id, "bot removed from the group");
          if (action === "add") await presentFromWhatsApp(sock, id);
        });
      });
    },

    async syncOnOpen(sock) {
      await syncGroups({
        directory,
        listKnown: () => deps.groups.listAll(),
        fetchParticipating: () => sock.groupFetchAllParticipating(),
        logger: deps.logger,
      });
    },
  };
}
