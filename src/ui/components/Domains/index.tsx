import React, {ReactElement, useEffect} from "react";
import "./domains.scss";
import {
  setOffset,
  useDomainByName,
  useDomainFetching,
  useDomainNames,
  useDomainOffset
} from "@src/ui/ducks/domains";
import {heightToMoment} from "@src/util/number";
import Name from "@src/ui/components/Name";
import {useDispatch} from "react-redux";
import {Loader} from "@src/ui/components/Loader";
import {useHistory} from "react-router";
import {useCurrentBlockHeight} from "@src/ui/ducks/node";
import classNames from "classnames";
const Network = require("hsd/lib/protocol/network");
const networkType = process.env.NETWORK_TYPE || 'main';

export default function Domains(): ReactElement {
  const offset = useDomainOffset();
  const domains = useDomainNames(offset);
  const fetching = useDomainFetching();
  const dispatch = useDispatch();

  useEffect(() => {
    return () => {
      dispatch(setOffset(20));
    }
  }, []);

  return (
    <div className="domains">
      {domains.map((name) => <DomainRow key={name} name={name} />)}
      {fetching && <Loader size={3} />}
      {!domains.length && !fetching && <div className="domains__empty">No domains</div>}
    </div>
  );
}

export function DomainRow(props: {name: string}): ReactElement {
  const domain = useDomainByName(props.name);
  const network = Network.get(networkType);
  const history = useHistory();
  const height = useCurrentBlockHeight();

  if (!domain) return <></>;

  const isTransferring = domain.ownerCovenantType === 'TRANSFER';
  // An unconfirmed covenant tx for this name. The owner covenant still reads
  // as it did before the tx was broadcast until it is mined.
  const pendingCovenant = domain.pendingCovenant;
  const canFinalize =
    isTransferring &&
    !pendingCovenant &&
    domain.transfer > 0 &&
    height >= domain.transfer + network.names.transferLockup;

  let status = 'Registered';

  if (pendingCovenant === 'TRANSFER') {
    status = 'Transfer Pending';
  } else if (pendingCovenant === 'FINALIZE') {
    status = 'Finalizing';
  } else if (pendingCovenant) {
    status = 'Pending';
  } else if (isTransferring) {
    status = canFinalize ? 'Ready to Finalize' : 'Transfer Pending';
  }

  const expiry = heightToMoment(domain.renewal + network.names.renewalWindow).format('YYYY-MM-DD');

  return (
    <div
      className="domain"
      onClick={() => history.push(`/domains/${props.name}`)}
    >
      <div className="domain__info">
        <div className="domain__info__name">
          <Name name={domain.name} />
          {
            ['REGISTER', 'FINALIZE', 'RENEW', 'UPDATE', 'TRANSFER'].includes(domain?.ownerCovenantType || '') && (
              <div
                className={classNames("domain__info__name__status", {
                  "domain__info__name__status--pending":
                    status !== 'Registered' && status !== 'Ready to Finalize',
                  "domain__info__name__status--ready":
                    status === 'Ready to Finalize',
                })}
              >
                {status}
              </div>
            )
          }
        </div>
        <div className="domain__info__expiry">
          {`Expires on ${expiry}`}
        </div>
      </div>
      <div className="domain__actions">
        <div className="domain__actions__action">

        </div>
      </div>
    </div>
  );
}
