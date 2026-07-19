import React, {ReactElement, useCallback, useState} from "react";
import SmallModal from "@src/ui/components/SmallModal";
import {ModalProps} from "@src/ui/components/Modal";
import Input from "@src/ui/components/Input";
import Button from "@src/ui/components/Button";
import postMessage from "@src/util/postMessage";
import MessageTypes from "@src/util/messageTypes";
import isValidAddress from "@src/util/address";
import Name from "@src/ui/components/Name";
import "./transfer-domain-modal.scss";

type Props = {
  name: string;
} & ModalProps;

export default function TransferDomainModal(props: Props): ReactElement {
  const {name} = props;
  const [address, setAddress] = useState("");
  const [addressErr, setAddressErr] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const onAddressChange = useCallback((e) => {
    const value = e.target.value.trim();
    setAddress(value);
    if (value && !isValidAddress(value)) {
      setAddressErr("Invalid address");
    } else {
      setAddressErr("");
    }
  }, []);

  const transfer = useCallback(
    async (e) => {
      if (sending) return;

      if (!isValidAddress(address)) {
        setAddressErr("Invalid address");
        return;
      }

      setSending(true);
      setError("");

      try {
        const tx = await postMessage({
          type: MessageTypes.CREATE_TRANSFER,
          payload: {name, address},
        });

        if (!tx) {
          setSending(false);
          return;
        }

        await postMessage({
          type: MessageTypes.ADD_TX_QUEUE,
          payload: tx,
        });

        // Queue is now non-empty, so the popup switches to the confirm view.
        props.onClose && props.onClose(e);
      } catch (err: any) {
        setError(err.message);
        setSending(false);
      }
    },
    [name, address, sending, props.onClose]
  );

  return (
    <SmallModal onClose={props.onClose}>
      <div className="transfer-domain-modal__title">
        Transfer <Name name={name} slash />
      </div>
      <p className="transfer-domain-modal__desc">
        Enter the Handshake address that should receive this domain.
      </p>
      <Input
        label="Recipient Address"
        value={address}
        onChange={onAddressChange}
        errorMessage={addressErr}
        spellCheck={false}
        onKeyUp={(e) => e.key === "Enter" && transfer(e)}
        disabled={sending}
        autoFocus
      />
      <p className="transfer-domain-modal__warning">
        Transfers are final once finalized. After confirming, a ~2 day
        (288&nbsp;block) lockup begins; you must then Finalize the transfer to
        complete it. You can Cancel any time before finalizing.
      </p>
      {error && <small className="error-message">{error}</small>}
      <div className="transfer-domain-modal__actions">
        <Button
          className="transfer-domain-modal__cta"
          disabled={sending || !isValidAddress(address)}
          loading={sending}
          onClick={transfer}
        >
          Transfer
        </Button>
      </div>
    </SmallModal>
  );
}
