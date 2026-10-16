
## Paper Digest Generator

Workflow:

- The main function receives either 
    - HTML,PDF - pass directly to agent
    - link - access via semanticscholar or arxiv API if arxiv (gets html version).
- HTML or PDF is given to the agent. The agent digests the content of the paper according to the master prompt.
- The agent outputs a JSON of the digest.
- The digest is processed into the template HTMLs.
