// Task dispatch store: publishing, claiming view, completion, kill, and timeout sweep.
// System notifications are delivered by the server after store calls return, so this
// module only owns DB state.
function createTaskStore(db) {
  const getAgent = db.prepare(`SELECT name FROM agents WHERE name = ?`);
  const activeAssignmentExists = db.prepare(`
    SELECT 1
    FROM task_assignments a
    JOIN tasks t ON t.id = a.task_id
    WHERE a.agent_name = ? AND t.status = 'active'
    LIMIT 1
  `);

  const insertTask = db.prepare(`
    INSERT INTO tasks (publisher, background, status, created_at, archived_at, timeout_at)
    VALUES (@publisher, @background, 'active', @created_at, NULL, @timeout_at)
  `);
  const insertAssignment = db.prepare(`
    INSERT INTO task_assignments (task_id, agent_name, spec, status, result, done_at)
    VALUES (@task_id, @agent_name, @spec, 'pending', NULL, NULL)
  `);

  const publish = db.transaction((publisher, background, assignments, timeoutMinutes) => {
    const names = Object.keys(assignments);
    if (names.length === 0) throw new Error("assignments must contain at least one agent");

    const unknown = names.filter((name) => !getAgent.get(name));
    if (unknown.length > 0) throw new Error(`agents are not registered: ${unknown.join(", ")}`);
    const busy = names.filter((name) => activeAssignmentExists.get(name));
    if (busy.length > 0) throw new Error(`agents already enrolled in an active task: ${busy.join(", ")}`);

    const createdAt = new Date().toISOString();
    const timeoutAt = timeoutMinutes > 0 ? new Date(Date.now() + timeoutMinutes * 60000).toISOString() : null;
    const info = insertTask.run({ publisher, background, created_at: createdAt, timeout_at: timeoutAt });
    const taskId = Number(info.lastInsertRowid);
    for (const name of names) {
      insertAssignment.run({ task_id: taskId, agent_name: name, spec: String(assignments[name]) });
    }
    return { taskId, createdAt, timeoutAt };
  });

  const currentForAgent = db.prepare(`
    SELECT t.id, t.publisher, t.background, t.status, t.created_at, t.timeout_at,
           a.spec, a.status AS assignment_status
    FROM task_assignments a
    JOIN tasks t ON t.id = a.task_id
    WHERE a.agent_name = ? AND t.status = 'active'
    ORDER BY t.id DESC
    LIMIT 1
  `);

  const assignmentForUpdate = db.prepare(`
    SELECT a.id, a.agent_name, t.id AS task_id, t.publisher
    FROM task_assignments a
    JOIN tasks t ON t.id = a.task_id
    WHERE a.agent_name = ? AND t.status = 'active' AND a.status = 'pending'
    ORDER BY t.id DESC
    LIMIT 1
  `);
  const markAssignmentDone = db.prepare(
    `UPDATE task_assignments SET status = 'done', result = ?, done_at = ? WHERE id = ? AND status = 'pending'`,
  );
  const pendingCount = db.prepare(
    `SELECT COUNT(*) AS count FROM task_assignments WHERE task_id = ? AND status = 'pending'`,
  );
  const finishTask = db.prepare(
    `UPDATE tasks SET status = ?, archived_at = ? WHERE id = ? AND status = 'active'`,
  );
  const assignmentsOfTask = db.prepare(
    `SELECT agent_name, status FROM task_assignments WHERE task_id = ? ORDER BY id`,
  );

  const complete = db.transaction((agent, result) => {
    const row = assignmentForUpdate.get(agent);
    if (!row) return { completed: false };
    markAssignmentDone.run(result || null, new Date().toISOString(), row.id);
    const remaining = pendingCount.get(row.task_id).count;
    let taskCompleted = false;
    if (remaining === 0) {
      finishTask.run("done", new Date().toISOString(), row.task_id);
      taskCompleted = true;
    }
    return { completed: true, taskId: row.task_id, publisher: row.publisher, taskCompleted };
  });

  const getTaskForKill = db.prepare(
    `SELECT id, publisher FROM tasks WHERE id = ? AND status = 'active'`,
  );

  const kill = db.transaction((taskId) => {
    const task = getTaskForKill.get(taskId);
    if (!task) return { killed: false };
    finishTask.run("killed", new Date().toISOString(), taskId);
    return { killed: true, publisher: task.publisher, assignees: assignmentsOfTask.all(taskId).map((r) => r.agent_name) };
  });

  const timeoutSweep = db.transaction(() => {
    const now = new Date().toISOString();
    const rows = db
      .prepare(`SELECT id, publisher FROM tasks WHERE status = 'active' AND timeout_at IS NOT NULL AND timeout_at <= ?`)
      .all(now);
    const swept = [];
    for (const row of rows) {
      finishTask.run("failed", now, row.id);
      swept.push({
        taskId: row.id,
        publisher: row.publisher,
        assignees: assignmentsOfTask.all(row.id).map((r) => r.agent_name),
      });
    }
    return swept;
  });

  const overviewStmt = db.prepare(`
    SELECT id, publisher, background, status, created_at, timeout_at
    FROM tasks
    WHERE status = 'active'
    ORDER BY id
  `);

  function overview() {
    return overviewStmt.all().map((task) => ({
      id: task.id,
      publisher: task.publisher,
      background: task.background,
      status: task.status,
      createdAt: task.created_at,
      timeoutAt: task.timeout_at,
      assignments: assignmentsOfTask.all(task.id),
    }));
  }

  return { publish, currentForAgent, complete, kill, timeoutSweep, overview };
}

module.exports = { createTaskStore };
