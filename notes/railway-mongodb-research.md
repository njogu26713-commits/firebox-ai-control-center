# Railway MongoDB research

Source: https://docs.railway.com/databases/mongodb

Railway’s official MongoDB template provisions a MongoDB service from the official Mongo Docker image. The Mongo service exposes `MONGOHOST`, `MONGOPORT`, `MONGOUSER`, `MONGOPASSWORD`, and `MONGO_URL`. Applications in the same Railway project can reference another service’s variable using Railway’s service-reference syntax, for example `${{MongoDB.MONGO_URL}}`, with the exact service name matching the Mongo service name.

Implementation decision: the Firebox control center should read `MONGODB_URI` only on the server. Railway should set `MONGODB_URI` to a reference of the Mongo service’s `MONGO_URL`; no database URL or credential belongs in GitHub.
