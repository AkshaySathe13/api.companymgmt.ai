import { Router } from "express";
import { teamService } from "./team.service.js";
import { personId } from "../people/person.schema.js";
import {
  memberInput,
  teamId,
  teamInput,
  teamQuery,
  teamUpdate,
} from "./team.schema.js";

export const teamRouter = Router();

teamRouter.get("/", async (req, res) => {
  res.json(await teamService.list(teamQuery.parse(req.query)));
});
teamRouter.get("/:id", async (req, res) => {
  res.json({ data: await teamService.get(teamId.parse(req.params.id)) });
});
teamRouter.post("/", async (req, res) => {
  const data = await teamService.create(teamInput.parse(req.body));
  res.location(`/api/v1/teams/${data.id}`).status(201).json({ data });
});
teamRouter.patch("/:id", async (req, res) => {
  res.json({
    data: await teamService.update(
      teamId.parse(req.params.id),
      teamUpdate.parse(req.body),
    ),
  });
});
teamRouter.delete("/:id", async (req, res) => {
  await teamService.remove(teamId.parse(req.params.id));
  res.status(204).end();
});
teamRouter.post("/:id/members", async (req, res) => {
  const data = await teamService.addMember(
    teamId.parse(req.params.id),
    memberInput.parse(req.body).personId,
  );
  res.status(201).json({ data });
});
teamRouter.delete("/:id/members/:personId", async (req, res) => {
  res.json({
    data: await teamService.removeMember(
      teamId.parse(req.params.id),
      personId.parse(req.params.personId),
    ),
  });
});
