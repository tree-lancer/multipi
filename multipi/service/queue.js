function createQueue(db) {
  const insertMessage = db.prepare(`
    INSERT INTO messages (sender, dest, subject, content, attachment_json, reply_to_id, created_at)
    VALUES (@sender, @dest, @subject, @content, @attachment_json, @reply_to_id, @created_at)
  `);

  const recvSelect = db.prepare(`
    SELECT id, sender, dest, subject, content, attachment_json, reply_to_id, created_at
    FROM messages
    WHERE dest = ? AND delivered_at IS NULL
    ORDER BY id
    LIMIT ?
  `);

  const recvSelectFrom = db.prepare(`
    SELECT id, sender, dest, subject, content, attachment_json, reply_to_id, created_at
    FROM messages
    WHERE dest = ? AND sender = ? AND delivered_at IS NULL
    ORDER BY id
    LIMIT ?
  `);

  const markDelivered = db.prepare(`UPDATE messages SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL`);
  const pendingCount = db.prepare(`SELECT COUNT(*) AS count FROM messages WHERE dest = ? AND delivered_at IS NULL`);
  const pendingMaxId = db.prepare(`SELECT MAX(id) AS maxId FROM messages WHERE dest = ? AND delivered_at IS NULL`);
  const pendingBySender = db.prepare(`
    SELECT sender, subject, COUNT(*) AS count
    FROM messages
    WHERE dest = ? AND delivered_at IS NULL
    GROUP BY sender, subject
  `);

  const sinceSelect = db.prepare(`
    SELECT id, sender, dest, subject, content, attachment_json, reply_to_id, created_at
    FROM messages
    WHERE id > ?
    ORDER BY id
    LIMIT ?
  `);

  const sendMany = db.transaction((sender, dests, message) => {
    const ids = [];
    const messages = [];
    const createdAt = new Date().toISOString();
    for (const dest of dests) {
      const info = insertMessage.run({
        sender,
        dest,
        subject: message.subject,
        content: message.content,
        attachment_json: JSON.stringify(message.attachment ?? []),
        reply_to_id: message.reply_to ?? null,
        created_at: createdAt,
      });
      const id = Number(info.lastInsertRowid);
      ids.push(id);
      messages.push({
        id,
        from: sender,
        to: dest,
        subject: message.subject,
        content: message.content,
        attachment: message.attachment ?? [],
        replyTo: message.reply_to ?? undefined,
        createdAt,
      });
    }
    return { ids, messages };
  });

  const recv = db.transaction((agent, limit, from) => {
    const now = new Date().toISOString();
    const rows = from ? recvSelectFrom.all(agent, from, limit) : recvSelect.all(agent, limit);
    for (const row of rows) markDelivered.run(now, row.id);
    return rows.map(rowToMessage);
  });

  return {
    send(sender, dests, message) {
      const { ids, messages } = sendMany(sender, dests, message);
      return { inserted: ids.length, ids, messages };
    },
    recv(agent, limit, from) {
      return recv(agent, Math.max(1, Math.floor(limit || 10)), from || undefined);
    },
    count(agent) {
      return Number(pendingCount.get(agent).count || 0);
    },
    pendingBatch(agent) {
      const maxId = Number(pendingMaxId.get(agent).maxId || 0);
      const rows = pendingBySender.all(agent);
      const bySenderMap = new Map();
      for (const row of rows) {
        let entry = bySenderMap.get(row.sender);
        if (!entry) {
          entry = { sender: row.sender, count: 0, subjects: {} };
          bySenderMap.set(row.sender, entry);
        }
        entry.count += row.count;
        entry.subjects[row.subject] = (entry.subjects[row.subject] || 0) + row.count;
      }
      const bySender = [...bySenderMap.values()];
      const totalCount = bySender.reduce((sum, entry) => sum + entry.count, 0);
      return { agent, maxId, totalCount, bySender };
    },
    since(afterId, limit) {
      return sinceSelect.all(Number(afterId) || 0, Math.max(1, Math.floor(limit || 200))).map(rowToMessage);
    },
  };
}

function rowToMessage(row) {
  return {
    id: row.id,
    from: row.sender,
    to: row.dest,
    subject: row.subject,
    content: row.content,
    attachment: JSON.parse(row.attachment_json || "[]"),
    replyTo: row.reply_to_id ?? undefined,
    createdAt: row.created_at,
  };
}

module.exports = { createQueue };
