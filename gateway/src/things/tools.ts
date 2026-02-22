// Things3 agent tools — task management from within agent conversations

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import {
  getActiveTasks,
  getProjects,
  getAreas,
  getCompletedTasks,
  createTask,
  completeTask,
  uncompleteTask,
  updateTask,
  moveTask,
  createProject,
  type ThingsList,
} from "./client.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

const handlers = new Map<string, ToolHandler>();

// ─── tasks_list: List active tasks from Things3 ───

handlers.set("tasks_list", async (input) => {
  const { list, project, area, limit } = input as {
    list?: string;
    project?: string;
    area?: string;
    limit?: number;
  };

  let tasks = getActiveTasks();

  if (list) {
    tasks = tasks.filter((t) => t.list === list);
  }
  if (project) {
    tasks = tasks.filter((t) =>
      t.projectTitle?.toLowerCase().includes(project.toLowerCase()),
    );
  }
  if (area) {
    tasks = tasks.filter((t) =>
      t.areaTitle?.toLowerCase().includes(area.toLowerCase()),
    );
  }

  // Sort: today by todayIndex, others by index
  if (list === "today") {
    tasks.sort((a, b) => a.todayIndex - b.todayIndex);
  }

  const maxItems = limit || 30;
  const truncated = tasks.length > maxItems;
  tasks = tasks.slice(0, maxItems);

  return {
    tasks: tasks.map((t) => ({
      uuid: t.uuid,
      title: t.title,
      list: t.list,
      project: t.projectTitle,
      area: t.areaTitle,
      tags: t.tags,
      notes: t.notes ? t.notes.slice(0, 200) : null,
      startDate: t.startDate,
      deadline: t.deadline,
      checklist: t.checklistTotal > 0
        ? `${t.checklistDone}/${t.checklistTotal}`
        : null,
    })),
    count: tasks.length,
    truncated,
  };
});

// ─── tasks_create: Create a new task in Things3 ───

handlers.set("tasks_create", async (input) => {
  const {
    title, list, when, notes, tags,
    project_id, heading, checklist_items,
  } = input as {
    title: string;
    list?: string;
    when?: string;
    notes?: string;
    tags?: string[];
    project_id?: string;
    heading?: string;
    checklist_items?: string[];
  };

  await createTask(title, {
    list,
    when,
    notes,
    tags,
    listId: project_id,
    heading,
    checklistItems: checklist_items,
  });

  return { created: true, title };
});

// ─── tasks_complete: Mark a task as done ───

handlers.set("tasks_complete", async (input) => {
  const { uuid } = input as { uuid: string };
  await completeTask(uuid);
  return { completed: true, uuid };
});

// ─── tasks_update: Update an existing task ───

handlers.set("tasks_update", async (input) => {
  const { uuid, title, notes, deadline, when, tags } = input as {
    uuid: string;
    title?: string;
    notes?: string;
    deadline?: string;
    when?: string;
    tags?: string[];
  };

  await updateTask(uuid, { title, notes, deadline, when, tags });
  return { updated: true, uuid };
});

// ─── tasks_move: Move a task to a different list ───

handlers.set("tasks_move", async (input) => {
  const { uuid, list } = input as { uuid: string; list: string };
  await moveTask(uuid, list as ThingsList);
  return { moved: true, uuid, list };
});

// ─── tasks_projects: List Things3 projects ───

handlers.set("tasks_projects", async () => {
  const projects = getProjects();
  return {
    projects: projects.map((p) => ({
      uuid: p.uuid,
      title: p.title,
      area: p.areaTitle,
      taskCount: p.taskCount,
    })),
    count: projects.length,
  };
});

// ─── tasks_logbook: List recently completed tasks ───

handlers.set("tasks_logbook", async (input) => {
  const { limit } = input as { limit?: number };
  const tasks = getCompletedTasks(limit || 20);
  return {
    tasks: tasks.map((t) => ({
      uuid: t.uuid,
      title: t.title,
      project: t.projectTitle,
      area: t.areaTitle,
      completedAt: t.completedAt,
    })),
    count: tasks.length,
  };
});

// ─── tasks_create_project: Create a new project ───

handlers.set("tasks_create_project", async (input) => {
  const { title, notes, area_id, deadline, tags } = input as {
    title: string;
    notes?: string;
    area_id?: string;
    deadline?: string;
    tags?: string[];
  };

  await createProject(title, {
    notes,
    areaId: area_id,
    deadline,
    tags,
  });

  return { created: true, title };
});

// ─── Exports ───

export function getThingsToolHandlers(): Map<string, ToolHandler> {
  return handlers;
}

export function getThingsToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "tasks_list",
      description:
        "List active tasks from Things3. Can filter by list (inbox, today, upcoming, anytime, someday), project, or area. Returns task titles, lists, projects, deadlines, and tags.",
      input_schema: {
        type: "object" as const,
        properties: {
          list: { type: "string", enum: ["inbox", "today", "upcoming", "anytime", "someday"], description: "Filter by Things3 list" },
          project: { type: "string", description: "Filter by project name (partial match)" },
          area: { type: "string", description: "Filter by area name (partial match)" },
          limit: { type: "number", description: "Max tasks to return (default: 30)" },
        },
        required: [],
      },
    },
    {
      name: "tasks_create",
      description:
        "Create a new task in Things3. Optionally assign to a list, project, set deadline, add tags, or include checklist items.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Task title" },
          list: { type: "string", enum: ["inbox", "today", "upcoming", "anytime", "someday"], description: "Which list to add to (default: inbox)" },
          when: { type: "string", description: "When to schedule (e.g. 'today', 'tomorrow', 'evening', '2026-02-25', 'anytime', 'someday')" },
          notes: { type: "string", description: "Task notes/description" },
          tags: { type: "array", items: { type: "string" }, description: "Tags to assign" },
          project_id: { type: "string", description: "Project UUID to add this task to" },
          heading: { type: "string", description: "Heading name within the project" },
          checklist_items: { type: "array", items: { type: "string" }, description: "Checklist items (sub-tasks)" },
        },
        required: ["title"],
      },
    },
    {
      name: "tasks_complete",
      description: "Mark a Things3 task as complete. Use tasks_list first to find the UUID.",
      input_schema: {
        type: "object" as const,
        properties: {
          uuid: { type: "string", description: "Task UUID from tasks_list" },
        },
        required: ["uuid"],
      },
    },
    {
      name: "tasks_update",
      description: "Update an existing Things3 task: change title, notes, deadline, schedule, or tags.",
      input_schema: {
        type: "object" as const,
        properties: {
          uuid: { type: "string", description: "Task UUID" },
          title: { type: "string", description: "New title" },
          notes: { type: "string", description: "New notes" },
          deadline: { type: "string", description: "New deadline (YYYY-MM-DD or empty to clear)" },
          when: { type: "string", description: "Reschedule (e.g. 'today', 'tomorrow', '2026-02-25')" },
          tags: { type: "array", items: { type: "string" }, description: "Replace tags" },
        },
        required: ["uuid"],
      },
    },
    {
      name: "tasks_move",
      description: "Move a Things3 task to a different list (inbox, today, upcoming, anytime, someday).",
      input_schema: {
        type: "object" as const,
        properties: {
          uuid: { type: "string", description: "Task UUID" },
          list: { type: "string", enum: ["inbox", "today", "upcoming", "anytime", "someday"], description: "Target list" },
        },
        required: ["uuid", "list"],
      },
    },
    {
      name: "tasks_projects",
      description: "List all active Things3 projects with their areas and task counts.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "tasks_logbook",
      description: "List recently completed tasks from the Things3 logbook.",
      input_schema: {
        type: "object" as const,
        properties: {
          limit: { type: "number", description: "Max tasks to return (default: 20)" },
        },
        required: [],
      },
    },
    {
      name: "tasks_create_project",
      description: "Create a new project in Things3.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Project title" },
          notes: { type: "string", description: "Project notes" },
          area_id: { type: "string", description: "Area UUID to assign to" },
          deadline: { type: "string", description: "Project deadline (YYYY-MM-DD)" },
          tags: { type: "array", items: { type: "string" }, description: "Tags to assign" },
        },
        required: ["title"],
      },
    },
  ];
}
