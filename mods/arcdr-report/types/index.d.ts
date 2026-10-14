// Values reported to herdr as pane tokens, by name; undefined clears one. arcdr reads each as `token:<name>`.
export type Tokens = Record<string, string | undefined>

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

// One item of the list the model keeps, whether it wrote it with TodoWrite or the Task tools.
export type TodoItem = { text: string; doing?: string; status: TodoStatus }
