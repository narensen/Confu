// Supabase queries are lazy: they run only when awaited or .then()-ed, so a
// bare `void supabase.from(…).update(…)` sends nothing at all. For writes
// nobody waits on (saving the page you're on, a pass note, a flag), this
// sends the query and reports a failure in the console instead.
export function fire(query: PromiseLike<{ error: { message: string } | null }>, what: string) {
  query.then(
    ({ error }) => {
      if (error) console.warn(`Couldn't save ${what}: ${error.message}`);
    },
    (err: unknown) => console.warn(`Couldn't save ${what}:`, err),
  );
}
