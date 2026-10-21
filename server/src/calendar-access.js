// © 2026 DobrayaSwaga. See LICENSE.
export const isAdmin = (user) => user.permissions.includes("*");
export function taskVisibility(user, alias = "t") {
  return isAdmin(user)
    ? "1=1"
    : `(${alias}.scope = 'shared' OR ${alias}.assignee_id = ${Number(user.id)} OR ${alias}.created_by = ${Number(user.id)})`;
}
export const canEditTask = (user, task) =>
  isAdmin(user) || task.created_by === user.id || task.assignee_id === user.id;
export function validDateTime(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value)
  )
    return false;
  const [date, time] = value.split("T");
  const parsed = new Date(`${date}T12:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date &&
    (!time || (Number(time.slice(0, 2)) < 24 && Number(time.slice(3)) < 60))
  );
}
