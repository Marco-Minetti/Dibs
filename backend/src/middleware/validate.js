// Returns middleware that validates req[source] against a zod schema and
// replaces it with the parsed (typed, stripped) value.
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const parsed = schema.parse(req[source]);
    req[source] = parsed;
    next();
  };
}
