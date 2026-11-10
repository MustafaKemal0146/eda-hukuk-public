# syntax=docker/dockerfile:1.7
# objstore (014 §3.9): SeaweedFS üzerine ince katman; /data 10003'e ait, kök dışı çalışır.
FROM chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d
USER root
RUN mkdir -p /data /opt/eda && chown -R 10003:10003 /data
COPY --chmod=0755 infra/objstore/entrypoint.sh /opt/eda/entrypoint.sh
USER 10003:10003
ENTRYPOINT ["/opt/eda/entrypoint.sh"]
