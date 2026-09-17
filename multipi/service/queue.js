function createQueue(db) {
  const insertMessage = db.prepare(`
    INSERT INTO messages (sender, dest, subject, content, attachment_json, created_at)
    VALUES (@sender, @dest, @subject, @content, @attachment_json, @created_at)
  `);

  const recvSelect = db.prepare(`
    SELECT id, sender, dest, subject, content, attachment_json, created_at
    FROM messages
    WHERE dest = ? AND delivered_at IS NULL
    ORDER BY id
    LIMIT ?
  `);

  const markDelivered = db.prepare(`UPDATE messages SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL`);
  const pendingCount = db.prepare(`SELECT COUNT(*) AS count FROM messages WHERE dest = ? AND delivered_at IS NULL`);

  const sendMany = db.transaction((sender, dests, message) => {
    const ids = [];
    const createdAt = new Date().toISOString();
    for (const dest of dests) {
      const info = insertMessage.run({
        sender,
        dest,
        subject: message.subject,
        content: message.content,
        attachment_json: JSON.stringify(message.attachment ?? []),
        created_at: createdAt,
      });
      ids.push(Number(info.lastInsertRowid));
    }
    return ids;
  });

  const recv = db.transaction((agent, limit) => {
    const now = new Date().toISOString();
    const rows = recvSelect.all(agent, limit);
    for (const row of rows) markDelivered.run(now, row.id);
    return rows.map(rowToMessage);
  });

  return {
    send(sender, dests, message) {
      const ids = sendMany(sender, dests, message);
      return { inserted: ids.length, ids };
    },
    recv(agent, limit) {
      return recv(agent, Math.max(1, Math.floor(limit || 10)));
    },
    count(agent) {
      return Number(pendingCount.get(agent).count || 0);
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
    createdAt: row.created_at,
  };
}

module.exports = { createQueue };
