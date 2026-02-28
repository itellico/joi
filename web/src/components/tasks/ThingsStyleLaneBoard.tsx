export interface ThingsLaneTask {
  id: string;
  title: string;
  meta?: string;
}

export interface ThingsLaneSection {
  heading: string;
  tasks: ThingsLaneTask[];
}

export function ThingsStyleLaneBoard({ sections }: { sections: ThingsLaneSection[] }) {
  return (
    <div className="things-lane-board">
      {sections.map((section) => (
        <section key={section.heading} className="things-lane-section t3-project-heading-drop">
          <div className="t3-heading-section things-lane-heading">
            <span className="t3-heading-label things-lane-title">{section.heading}</span>
            <span className="t3-heading-line things-lane-line" />
            <span className="t3-heading-dots things-lane-menu" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="3" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="13" cy="8" r="1.5" />
              </svg>
            </span>
          </div>

          {section.tasks.length > 0 && (
            <div className="things-lane-task-list">
              {section.tasks.map((task) => (
                <div key={task.id} className="t3-row things-lane-task-item">
                  <span className="t3-check things-lane-checkbox" aria-hidden="true" />
                  <div className="t3-row-content">
                    <div className="t3-row-body">
                      <span className="t3-row-title things-lane-task-title">{task.title}</span>
                      {task.meta && (
                        <span className="things-lane-task-meta">{task.meta}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {section.tasks.length === 0 && (
            <div className="t3-section-drop-hint things-lane-empty">No open tasks</div>
          )}
        </section>
      ))}
    </div>
  );
}
