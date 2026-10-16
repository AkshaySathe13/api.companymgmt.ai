import { Router } from "express";
import { viewerOf } from "../auth/session.js";
import { personService } from "./person.service.js";
import {
  passwordReset,
  personId,
  personInput,
  personQuery,
  personUpdate,
} from "./person.schema.js";

// Mounted behind `authenticate`; the service applies the viewer's access rules.
export const personRouter = Router();

personRouter.get("/", async (req, res) => {
  res.json(
    await personService.list(viewerOf(req), personQuery.parse(req.query)),
  );
});
personRouter.get("/:id", async (req, res) => {
  res.json({
    data: await personService.get(viewerOf(req), personId.parse(req.params.id)),
  });
});
personRouter.post("/", async (req, res) => {
  const input = personInput.parse(req.body);
  const data = await personService.create(viewerOf(req), input);
  res.location(`/api/v1/people/${data.id}`).status(201).json({ data });
});
personRouter.patch("/:id", async (req, res) => {
  const id = personId.parse(req.params.id);
  const input = personUpdate.parse(req.body);
  res.json({ data: await personService.update(viewerOf(req), id, input) });
});
personRouter.post("/:id/password", async (req, res) => {
  const id = personId.parse(req.params.id);
  await personService.resetPassword(
    viewerOf(req),
    id,
    passwordReset.parse(req.body),
  );
  res.status(204).end();
});
personRouter.delete("/:id", async (req, res) => {
  await personService.remove(viewerOf(req), personId.parse(req.params.id));
  res.status(204).end();
});
