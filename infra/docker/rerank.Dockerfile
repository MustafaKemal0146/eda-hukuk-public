# syntax=docker/dockerfile:1.7
# TEI GPU (Ada Lovelace 89) + reranker model gömülü imajı (070 §10.3)
ARG TEI_IMAGE=ghcr.io/huggingface/text-embeddings-inference:89-1.9.1@sha256:73cfb0266bc31e8df6c2c266777784d6a548e0a246b76757793264dc0d95e90f
ARG PY_IMAGE=python:3.14-slim-trixie@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170

FROM ${PY_IMAGE} AS download
ARG MODEL_ID=BAAI/bge-reranker-v2-m3
ARG MODEL_REVISION=953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e
RUN test "${#MODEL_REVISION}" -eq 40 || { echo "MODEL_REVISION 40 haneli commit sha olmalı"; exit 1; }
RUN pip install --no-cache-dir "huggingface_hub[cli]==1.6.0"
ENV HF_HOME=/opt/hf
RUN hf download "${MODEL_ID}" --revision "${MODEL_REVISION}" \
    && rm -rf /opt/hf/hub/models--*/snapshots/*/onnx

FROM ${TEI_IMAGE}
COPY --from=download /opt/hf /opt/hf
RUN groupadd -g 10005 tei && useradd -u 10005 -g 10005 -M -s /usr/sbin/nologin tei && chmod -R a+rX /opt/hf
COPY --chmod=0755 infra/docker/tei-entrypoint.sh /opt/eda/tei-entrypoint.sh
ENV HF_HUB_OFFLINE=1 HF_HOME=/opt/hf
USER 10005:10005
ENTRYPOINT ["/opt/eda/tei-entrypoint.sh"]
